/**
 * MessageTemplates - Smart, context-aware message generation.
 * Crafts personalized messages based on opportunity context,
 * platform tone, conversation stage, and user signals.
 */

export class MessageTemplates {
  constructor() {
    // Platform-specific tone adjustments
    this.platformTones = {
      reddit: { style: 'casual', maxLength: 500, useMarkdown: true },
      discord: { style: 'casual', maxLength: 2000, useMarkdown: true },
      telegram: { style: 'direct', maxLength: 4096, useMarkdown: true },
      facebook: { style: 'friendly', maxLength: 1000, useMarkdown: false },
      twitter: { style: 'concise', maxLength: 280, useMarkdown: false },
      linkedin: { style: 'professional', maxLength: 1300, useMarkdown: false },
    };
  }

  /**
   * Generate an initial engagement message.
   */
  initialContact({ opportunity, post, platform, offering }) {
    const tone = this.platformTones[platform] || this.platformTones.reddit;
    const userName = post.authorName || post.author || 'there';
    const need = opportunity.need || 'what you\'re looking for';

    const templates = {
      casual: [
        `Hey ${userName}! Saw you're looking for ${need}. We've got ${offering.name} that might be exactly what you need - ${offering.description}. Happy to share more if you're interested!`,
        `Hey! Noticed your post about ${need}. ${offering.name} could be a solid fit here. ${offering.pitch || offering.description} Want me to share some details?`,
        `${userName} - saw your post! ${offering.name} handles exactly that. ${offering.description}. Want to hear more about how it works?`,
      ],
      professional: [
        `Hi ${userName}, I noticed you're looking for ${need}. I'd like to introduce ${offering.name} - ${offering.description}. Would you be open to a brief discussion about how it could help?`,
        `${userName}, your post resonated with me. We offer ${offering.name} which addresses exactly this need. ${offering.pitch || ''} I'd be happy to provide more details if you're interested.`,
      ],
      direct: [
        `Hi! Saw you need ${need}. Check out ${offering.name} - ${offering.description}. ${offering.signupUrl ? 'Details: ' + offering.signupUrl : 'Want more info?'}`,
        `Hey ${userName}! ${offering.name} does exactly what you're looking for. ${offering.pitch || offering.description} Interested?`,
      ],
      concise: [
        `Hey @${userName}! ${offering.name} might be what you need - ${offering.description.slice(0, 100)}. DM for details!`,
        `Looking for ${need}? Check out ${offering.name}! ${offering.pitch?.slice(0, 100) || ''} DM me.`,
      ],
      friendly: [
        `Hi ${userName}! I saw your post about ${need} and thought you might like ${offering.name}. ${offering.description} Would love to chat more about it!`,
        `Hey there ${userName}! ${offering.name} could really help with ${need}. ${offering.pitch || offering.description} Let me know if you'd like to know more!`,
      ],
    };

    const options = templates[tone.style] || templates.casual;
    let msg = options[Math.floor(Math.random() * options.length)];

    // Enforce max length
    if (msg.length > tone.maxLength) {
      msg = msg.slice(0, tone.maxLength - 3) + '...';
    }

    return msg;
  }

  /**
   * Generate a negotiation response.
   */
  negotiate({ conversation, reply, offering, platform }) {
    const tone = this.platformTones[platform] || this.platformTones.reddit;
    const content = (reply.content || '').toLowerCase();

    // Price inquiry
    if (content.includes('price') || content.includes('cost') || content.includes('how much')) {
      return this._priceResponse(offering, tone);
    }

    // Discount request
    if (content.includes('discount') || content.includes('cheaper') || content.includes('too expensive') || content.includes('budget')) {
      return this._discountResponse(offering, tone);
    }

    // Feature question
    if (content.includes('feature') || content.includes('what does') || content.includes('how does') || content.includes('can it')) {
      return this._featureResponse(offering, tone);
    }

    // Comparison request
    if (content.includes('compare') || content.includes('vs') || content.includes('alternative') || content.includes('better than')) {
      return this._comparisonResponse(offering, tone);
    }

    // General negotiation
    return this._generalNegotiation(offering, tone);
  }

  /**
   * Generate a closing message.
   */
  close({ conversation, offering, platform }) {
    const tone = this.platformTones[platform] || this.platformTones.reddit;

    const templates = {
      casual: `Awesome, let's make it happen! Here's how to get started: ${offering.signupUrl || offering.actionUrl || '[I\'ll send you the link]'}. If you need any help getting set up, just let me know!`,
      professional: `Excellent! I'll get you set up right away. Please proceed here: ${offering.signupUrl || offering.actionUrl || '[registration link]'}. I'm available if you need any assistance during onboarding.`,
      direct: `Done! Get started here: ${offering.signupUrl || offering.actionUrl || '[link]'}. Reach out if you need anything.`,
      concise: `Here you go: ${offering.signupUrl || offering.actionUrl || 'DM for link'}`,
      friendly: `That's great to hear! Here's the link to get started: ${offering.signupUrl || offering.actionUrl || '[I\'ll send it over]'}. Looking forward to having you on board!`,
    };

    return templates[tone.style] || templates.casual;
  }

  /**
   * Generate a follow-up message.
   */
  followUp({ conversation, offering, platform, attempt = 1 }) {
    const tone = this.platformTones[platform] || this.platformTones.reddit;

    if (attempt === 1) {
      return `Just following up on ${offering.name}! ${offering.description} Any questions I can answer?`;
    }

    if (attempt === 2) {
      return `Hey, wanted to check in one more time about ${offering.name}. We're currently offering ${offering.negotiationPitch || 'a great deal for new users'}. No pressure at all - just wanted to make sure you saw this!`;
    }

    // After 2 attempts, gentle close
    return `Last note about ${offering.name} - if you're ever interested in the future, feel free to reach out! ${offering.signupUrl || ''}`;
  }

  /**
   * Generate an admin report message.
   */
  adminReport(reportData) {
    const s = reportData.summary;
    return `[MINIGENT REPORT]\n` +
      `Agents: ${s.totalAgents} (${s.activeAgents} active)\n` +
      `Posts: ${s.totalPostsMonitored} | Opps: ${s.totalOpportunities}\n` +
      `Deals: ${s.totalDealsClosed}/${s.totalDealsInitiated} (${s.conversionRate}%)\n` +
      `Revenue: $${s.totalRevenue.toFixed(2)}`;
  }

  // --- Internal helpers ---

  _priceResponse(offering, tone) {
    const price = offering.price || 'competitive rates';
    const templates = {
      casual: `${offering.name} runs $${price}/mo. ${offering.negotiationPitch || 'Totally worth it for what you get.'} Want me to walk you through what\'s included?`,
      professional: `${offering.name} is priced at $${price}. ${offering.negotiationPitch || 'This includes full access to all features.'} I can provide a detailed breakdown if helpful.`,
      direct: `$${price}/mo for ${offering.name}. ${offering.negotiationPitch || 'Full feature set included.'}`,
      concise: `$${price}/mo. ${offering.negotiationPitch?.slice(0, 80) || 'Full access.'}`,
      friendly: `Great question! ${offering.name} is $${price}/mo. ${offering.negotiationPitch || 'It includes everything you need.'} Does that work with your budget?`,
    };
    return templates[tone.style] || templates.casual;
  }

  _discountResponse(offering, tone) {
    const discountedPrice = offering.price ? (offering.price * 0.8).toFixed(2) : 'special pricing';
    const templates = {
      casual: `I hear you on budget! I can do $${discountedPrice}/mo for the first 3 months. That's 20% off. Sound fair?`,
      professional: `I understand budget considerations. I can offer an introductory rate of $${discountedPrice}/mo for the first quarter. Would that work for your needs?`,
      direct: `Best I can do is $${discountedPrice}/mo for 3 months (20% off). Deal?`,
      concise: `$${discountedPrice}/mo for 3mo (20% off). Interested?`,
      friendly: `Totally understand! How about $${discountedPrice}/mo for the first 3 months? That's a 20% discount to get you started!`,
    };
    return templates[tone.style] || templates.casual;
  }

  _featureResponse(offering, tone) {
    return `${offering.name} includes: ${offering.description}. ${offering.pitch || 'It\'s designed to cover exactly what you need.'} Any specific features you\'re looking for?`;
  }

  _comparisonResponse(offering, tone) {
    return `What sets ${offering.name} apart: ${offering.pitch || offering.description}. Happy to go into specifics on any particular comparison you have in mind!`;
  }

  _generalNegotiation(offering, tone) {
    return `${offering.name} at $${offering.price || 'competitive pricing'} is a solid value. ${offering.negotiationPitch || 'We can definitely find something that works for you.'} What matters most to you?`;
  }
}
