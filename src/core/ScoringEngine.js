/**
 * ScoringEngine - Scores opportunities, leads, and agents based on
 * multiple factors like keyword relevance, user engagement signals,
 * historical conversion data, and platform quality.
 */
import { logger } from '../utils/logger.js';

export class ScoringEngine {
  constructor({ db }) {
    this.db = db;
    this.weights = {
      keywordRelevance: 0.30,
      userEngagement: 0.20,
      platformQuality: 0.15,
      historicalConversion: 0.20,
      recency: 0.15,
    };
  }

  /**
   * Score an opportunity for prioritization.
   * Returns 0-100 score.
   */
  scoreOpportunity(opportunity, post) {
    const scores = {
      keywordRelevance: this._scoreKeywordRelevance(opportunity),
      userEngagement: this._scoreUserEngagement(post),
      platformQuality: this._scorePlatformQuality(post),
      historicalConversion: this._scoreHistoricalConversion(opportunity.matchedOffering),
      recency: this._scoreRecency(post),
    };

    let total = 0;
    for (const [factor, weight] of Object.entries(this.weights)) {
      total += (scores[factor] || 0) * weight;
    }

    const finalScore = Math.round(Math.min(100, Math.max(0, total)));

    return {
      score: finalScore,
      breakdown: scores,
      grade: this._getGrade(finalScore),
      recommendation: this._getRecommendation(finalScore, scores),
    };
  }

  /**
   * Score an agent's overall performance.
   */
  scoreAgent(agent) {
    const stats = agent.stats || agent;
    const conversionRate = stats.dealsInitiated > 0
      ? stats.dealsClosed / stats.dealsInitiated
      : 0;
    const revenuePerPost = stats.postsMonitored > 0
      ? stats.revenue / stats.postsMonitored
      : 0;
    const opportunityRate = stats.postsMonitored > 0
      ? stats.opportunitiesDetected / stats.postsMonitored
      : 0;

    const scores = {
      conversionEfficiency: Math.min(100, Math.round(conversionRate * 200)),
      revenueEfficiency: Math.min(100, Math.round(revenuePerPost * 1000)),
      discoveryRate: Math.min(100, Math.round(opportunityRate * 500)),
      volume: Math.min(100, Math.round(Math.log10(stats.postsMonitored + 1) * 30)),
      dealVolume: Math.min(100, Math.round(stats.dealsClosed * 10)),
    };

    const overall = Math.round(
      scores.conversionEfficiency * 0.30 +
      scores.revenueEfficiency * 0.25 +
      scores.discoveryRate * 0.20 +
      scores.volume * 0.10 +
      scores.dealVolume * 0.15
    );

    return {
      score: overall,
      breakdown: scores,
      grade: this._getGrade(overall),
      stats: {
        conversionRate: (conversionRate * 100).toFixed(1) + '%',
        revenuePerPost: '$' + revenuePerPost.toFixed(4),
        opportunityRate: (opportunityRate * 100).toFixed(1) + '%',
      },
    };
  }

  /**
   * Score a lead (user who responded positively).
   */
  scoreLead(conversation) {
    const messages = conversation.messages || [];
    const userMessages = messages.filter(m => m.role === 'user');

    let score = 50; // Base score

    // Engagement level
    score += Math.min(20, userMessages.length * 5);

    // Positive signal detection
    const positiveWords = ['interested', 'yes', 'how much', 'price', 'sign up', 'deal', 'sounds good', 'tell me more', 'link'];
    const negativeWords = ['no thanks', 'not interested', 'spam', 'stop', 'unsubscribe', 'scam'];

    for (const msg of userMessages) {
      const content = (msg.content || '').toLowerCase();
      for (const word of positiveWords) {
        if (content.includes(word)) score += 5;
      }
      for (const word of negativeWords) {
        if (content.includes(word)) score -= 15;
      }
    }

    // Stage progression bonus
    const stageScores = { initial_contact: 0, negotiating: 15, closing: 25, closed: 30 };
    score += stageScores[conversation.stage] || 0;

    score = Math.min(100, Math.max(0, score));

    return {
      score,
      grade: this._getGrade(score),
      stage: conversation.stage,
      engagement: userMessages.length,
      recommendation: score >= 70 ? 'Hot lead - prioritize closing'
        : score >= 40 ? 'Warm lead - nurture with follow-ups'
        : 'Cold lead - may need re-engagement or different approach',
    };
  }

  /**
   * Rank all current opportunities by score.
   */
  rankOpportunities(opportunities) {
    return opportunities
      .map(opp => ({
        ...opp,
        scoring: this.scoreOpportunity(opp.opportunity, opp.post),
      }))
      .sort((a, b) => b.scoring.score - a.scoring.score);
  }

  // --- Internal scoring methods ---

  _scoreKeywordRelevance(opportunity) {
    const confidence = opportunity.confidence || 0;
    return Math.round(confidence * 100);
  }

  _scoreUserEngagement(post) {
    let score = 50; // Base
    const content = `${post.title || ''} ${post.content || ''} ${post.body || ''}`;

    // Longer posts suggest more invested users
    if (content.length > 200) score += 15;
    if (content.length > 500) score += 10;

    // Question marks indicate active seeking
    if (content.includes('?')) score += 10;

    // Urgency signals
    const urgentWords = ['urgent', 'asap', 'need now', 'immediately', 'today', 'deadline'];
    if (urgentWords.some(w => content.toLowerCase().includes(w))) score += 15;

    // Budget mentions
    const budgetWords = ['budget', '$', 'willing to pay', 'price range', 'can spend'];
    if (budgetWords.some(w => content.toLowerCase().includes(w))) score += 10;

    return Math.min(100, score);
  }

  _scorePlatformQuality(post) {
    const platformScores = {
      linkedin: 85,   // High business intent
      reddit: 70,     // Active communities
      twitter: 65,    // Quick engagement
      discord: 60,    // Niche communities
      telegram: 55,   // Crypto/tech focus
      facebook: 50,   // Mixed quality
    };
    return platformScores[post.platform] || 50;
  }

  _scoreHistoricalConversion(offering) {
    if (!offering || !this.db) return 50;

    try {
      const deals = this.db.getAllDeals(1000);
      const offeringDeals = deals.filter(d => d.offering === offering.name);
      if (offeringDeals.length === 0) return 50;

      // Higher conversion history = higher score
      return Math.min(100, 50 + offeringDeals.length * 5);
    } catch {
      return 50;
    }
  }

  _scoreRecency(post) {
    if (!post.timestamp) return 50;

    const ageMs = Date.now() - new Date(post.timestamp).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);

    if (ageHours < 1) return 100;
    if (ageHours < 6) return 85;
    if (ageHours < 24) return 70;
    if (ageHours < 72) return 50;
    if (ageHours < 168) return 30;
    return 10;
  }

  _getGrade(score) {
    if (score >= 90) return 'A+';
    if (score >= 80) return 'A';
    if (score >= 70) return 'B+';
    if (score >= 60) return 'B';
    if (score >= 50) return 'C+';
    if (score >= 40) return 'C';
    if (score >= 30) return 'D';
    return 'F';
  }

  _getRecommendation(score, breakdown) {
    if (score >= 80) return 'High-priority opportunity. Engage immediately with aggressive pitch.';
    if (score >= 60) return 'Good opportunity. Standard engagement recommended.';
    if (score >= 40) return 'Moderate opportunity. Engage but don\'t invest too much time.';
    return 'Low-priority. Consider skipping or using a light-touch approach.';
  }
}
