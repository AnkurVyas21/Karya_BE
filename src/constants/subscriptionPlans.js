const subscriptionPlans = [
  {
    id: 'starter',
    name: 'Starter',
    price: 499,
    durationMonths: 1,
    tagline: 'For professionals getting their first leads online.',
    features: [
      'Public profile listing',
      'Appears in search results',
      'Basic contact visibility',
      'Up to 5 highlighted skills'
    ]
  },
  {
    id: 'growth',
    name: 'Growth',
    price: 1299,
    durationMonths: 3,
    tagline: 'Built for steady lead generation and better visibility.',
    features: [
      'Everything in Starter',
      'Priority search placement',
      'Profile analytics dashboard',
      'Unlimited skills and service areas'
    ]
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 2299,
    durationMonths: 6,
    tagline: 'Best for established professionals scaling bookings.',
    features: [
      'Everything in Growth',
      'Verified pro badge',
      'Extended profile media support',
      'Premium support'
    ]
  }
];

const getSubscriptionPlan = (planId) => subscriptionPlans.find((plan) => plan.id === planId);

module.exports = {
  subscriptionPlans,
  getSubscriptionPlan
};
