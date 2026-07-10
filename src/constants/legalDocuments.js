const LEGAL_DOCUMENT_TYPES = ['terms', 'privacy'];

const DEFAULT_LEGAL_DOCUMENTS = {
  terms: {
    type: 'terms',
    eyebrow: 'Terms of Service',
    title: 'Terms and Conditions',
    intro: 'These Terms govern access to and use of Nasdiya, including local service discovery, provider profiles, messaging, bookings, provider websites, advertisements, subscriptions, and related growth tools.',
    version: '1.0',
    effectiveDate: new Date('2026-07-10T00:00:00.000Z'),
    sections: [
      {
        title: '1. Acceptance and eligibility',
        body: 'By creating an account, browsing Nasdiya, contacting a provider, listing services, booking a service, buying a growth tool, or otherwise using the platform, you agree to these Terms and the Privacy Policy.\nYou must be legally competent to enter into a contract under Indian law. If you use Nasdiya for a business, firm, shop, clinic, agency, or other organisation, you confirm that you are authorised to accept these Terms on its behalf.'
      },
      {
        title: '2. What Nasdiya does',
        body: 'Nasdiya is a technology platform that helps users discover, compare, contact, message, book, and transact with independent service providers. Nasdiya may also provide paid tools such as provider websites, visibility boosts, advertisements, verification workflows, templates, receipts, notifications, and dashboards.\nUnless Nasdiya expressly states otherwise in writing, providers are independent professionals or businesses. Nasdiya is not the employer, agent, partner, or legal representative of any provider or customer.'
      },
      {
        title: '3. Accounts, verification, and security',
        body: 'You must provide accurate account, contact, location, and profile information and keep it updated. Nasdiya may use email OTPs, account checks, manual review, provider verification, customer OTPs for service completion, and other controls to reduce fraud and protect users.\nYou are responsible for keeping your password, device, OTPs, and session secure. Tell us promptly if you believe your account has been misused.'
      },
      {
        title: '4. Provider responsibilities',
        body: 'Providers are responsible for the truthfulness of their profile, business website, services, prices, photos, products, offers, service areas, licences, certifications, availability, contact details, tax obligations, invoices, refunds, and customer communications.\nProviders must deliver services lawfully, safely, professionally, and in line with the information shown to customers. Providers must use customer contact details, booking details, messages, addresses, and payment information only for the relevant service request and related legal or accounting needs.'
      },
      {
        title: '5. Customer responsibilities',
        body: 'Customers must share accurate booking, address, contact, payment, and service requirement details. Customers should evaluate provider profiles, reviews, prices, availability, credentials, and service terms before engaging a provider.\nCustomers must not misuse provider contact information, submit false reviews, make fake bookings, avoid valid charges, or use Nasdiya for unlawful, unsafe, abusive, or fraudulent requests.'
      },
      {
        title: '6. Bookings, payments, cancellations, and refunds',
        body: 'Some providers may accept online booking requests, manual UPI payment confirmation, gateway payments, product orders, advance fees, service proof OTPs, receipts, refunds, and rescheduling. The provider is responsible for the service and for confirming completion, cancellation, refund, and payment status unless Nasdiya is expressly collecting a platform fee or subscription fee for its own tools.\nCancellation fees, refunds, replacements, exchanges, warranties, and service guarantees must be fair, transparent, and consistent with applicable Indian consumer laws. Nasdiya may help record payment references and receipts, but it does not guarantee that a provider or customer will complete a transaction.'
      },
      {
        title: '7. Reviews, messages, listings, and uploaded content',
        body: 'You are responsible for content you post, upload, send, or display, including profile details, photos, certificates, messages, reviews, ads, products, offers, articles, logos, documents, and website content. You must have the rights and permissions needed to share that content.\nYou grant Nasdiya a non-exclusive, worldwide, royalty-free licence to host, store, process, display, reproduce, resize, moderate, and distribute your content as needed to operate, market, secure, and improve the platform. Nasdiya may remove or restrict content that is illegal, misleading, unsafe, infringing, abusive, spammy, or harmful to users or the platform.'
      },
      {
        title: '8. Paid tools, subscriptions, boosts, and advertisements',
        body: 'Paid tools may include provider websites, subscriptions, profile boosts, verification workflows, advertisements, templates, receipts, and growth dashboards. Prices, duration, features, limits, and taxes may vary and may be shown before purchase.\nAdvertisement creatives and linked banners may be reviewed, approved, paused, rejected, or removed by Nasdiya. Paid placement, boost, or verification does not guarantee leads, bookings, revenue, ranking, or customer conversion.'
      },
      {
        title: '9. Prohibited use',
        body: 'You must not use Nasdiya to break the law, misrepresent identity or qualifications, harass or threaten people, upload harmful code, scrape or copy platform data at scale, bypass security controls, send spam, manipulate search or reviews, impersonate Nasdiya or another person, collect personal data without permission, or promote illegal goods or services.\nNasdiya may investigate suspicious activity and may restrict, suspend, deactivate, delete, or report accounts, listings, messages, ads, reviews, bookings, or payments where necessary.'
      },
      {
        title: '10. Platform availability and changes',
        body: 'Nasdiya may add, modify, pause, or discontinue features, plans, templates, pricing, routes, dashboards, ads, payment options, or other services. We try to keep the platform reliable, but we do not promise uninterrupted or error-free access.\nYou are responsible for maintaining your own device, internet connection, browser, app version, and backups of information you need outside Nasdiya.'
      },
      {
        title: '11. Disclaimers and limitation of liability',
        body: 'To the maximum extent allowed by applicable law, Nasdiya provides the platform on an "as is" and "as available" basis. Nasdiya does not warrant the quality, safety, legality, availability, pricing, timing, or suitability of any provider, customer, service, product, booking, offer, review, message, payment, or third-party service.\nNothing in these Terms excludes liability that cannot be excluded under Indian law. Subject to that, Nasdiya will not be liable for indirect, incidental, special, consequential, punitive, or loss-of-profit damages arising from platform use, user conduct, provider services, customer conduct, or third-party services.'
      },
      {
        title: '12. Grievance redressal and support',
        body: 'For account, booking, payment, content, privacy, or consumer grievance support, contact support@nasdiya.com. Please include your name, registered email or mobile number, relevant booking or transaction ID, screenshots if available, and a clear description of the issue.\nWhere applicable, Nasdiya will aim to acknowledge consumer complaints within 48 hours and resolve them within one month, subject to the information and cooperation needed from the user, provider, payment partner, or other third party.'
      },
      {
        title: '13. Termination and account deletion',
        body: 'You may stop using Nasdiya or request account deactivation or deletion through available account controls or support. Some information may be retained where required for legal compliance, security, dispute resolution, accounting, fraud prevention, or completed transactions.\nNasdiya may suspend, deactivate, or remove accounts, profiles, ads, content, or access if these Terms are violated, if information appears false or risky, if required by law, or if continued access could harm users or the platform.'
      },
      {
        title: '14. Governing law and jurisdiction',
        body: 'These Terms are governed by the laws of India. Subject to mandatory consumer protection rights and any forum that cannot legally be excluded, disputes will be subject to the courts having jurisdiction over Nasdiya\'s principal place of business in India.\nIf any part of these Terms is found unenforceable, the rest will continue to apply. Nasdiya may update these Terms and notify users by email, in-app notice, or other reasonable method.'
      }
    ]
  },
  privacy: {
    type: 'privacy',
    eyebrow: 'Privacy Policy',
    title: 'Privacy Policy',
    intro: 'This Privacy Policy explains how Nasdiya collects, uses, shares, protects, and retains personal data when people use the platform as visitors, customers, providers, advertisers, or administrators.',
    version: '1.0',
    effectiveDate: new Date('2026-07-10T00:00:00.000Z'),
    sections: [
      {
        title: '1. Scope and role',
        body: 'Nasdiya processes digital personal data to provide a local professional discovery and service commerce platform in India. This policy applies to website and app visitors, registered customers, service providers, people who contact support, people who submit inquiries or bookings, and people who interact with provider websites or ads.\nFor most platform operations, Nasdiya acts as the data fiduciary responsible for deciding why and how personal data is processed. Providers may independently process customer data they receive through calls, messages, bookings, orders, or direct service arrangements.'
      },
      {
        title: '2. Personal data we collect',
        body: 'We may collect account details such as name, email, mobile number, password hash, gender, profile photo, preferred language and theme, account status, OTP verification status, and social login identifiers.\nFor provider accounts, we may collect profession, skills, tags, service areas, experience, description, certificates, availability, charges, location, address, pincode, latitude and longitude if provided, contact display preference, business website details, services, products, offers, articles, gallery images, SEO settings, UPI details used for provider payments, verification information, ads, and subscription details.\nFor platform use, we may collect search queries, AI search prompts, inferred profession context, bookmarks, reviews, messages, attachments, conversations, notifications, support requests, booking details, product order details, customer address, payment references, manual UPI transaction IDs, receipt history, refund details, device or browser information, IP address, approximate location, visitor ID, page views, referrer, and analytics events.'
      },
      {
        title: '3. Why we use personal data',
        body: 'We use personal data to create and secure accounts, verify email addresses and provider actions, show relevant providers by profession and location, run search and AI-assisted discovery, enable profile completion, display provider listings and websites, process messages, support bookings and orders, issue receipts, manage refunds, send notifications, provide customer support, moderate content, prevent fraud, enforce Terms, improve the platform, run ads and subscriptions, and comply with legal obligations.\nWe also use operational data to measure page visits, profile views, ad views, campaign performance, profession coverage, account health, and service quality.'
      },
      {
        title: '4. Consent, lawful uses, and withdrawal',
        body: 'Where processing is based on consent, we seek consent through clear actions such as registration, OTP verification, profile submission, booking submission, message sending, payment submission, review posting, preference settings, or other platform controls. Consent should be free, specific, informed, unconditional, and unambiguous.\nYou may withdraw consent or request changes through account controls or by contacting support@nasdiya.com. Withdrawal may limit features that require the data, and it will not affect processing already completed or processing required for law, security, disputes, completed transactions, or legitimate platform operations permitted by applicable Indian law.'
      },
      {
        title: '5. How we share personal data',
        body: 'We share data with other users where needed for the service, such as showing provider public profiles to customers, sharing booking or order details with the relevant provider, sharing customer messages with the selected provider, and showing reviews or public listing content.\nWe may share data with service providers that support hosting, storage, email delivery, OTPs, payments, receipts, analytics, security, customer support, image processing, and other platform operations. We may also share data with administrators and moderators, payment or banking partners, legal advisers, regulators, law enforcement, courts, or government authorities where required or permitted by law.\nWe do not sell personal data. We do not allow providers to use customer data for unrelated marketing unless the customer has separately agreed.'
      },
      {
        title: '6. Public provider profiles and websites',
        body: 'Provider profiles, business websites, services, products, offers, images, reviews, ratings, public contact details, city, state, service areas, and business descriptions may be visible to the public or to search engines if the provider chooses to publish or display them.\nProviders should not upload personal data, confidential information, or third-party content unless they have the right and permission to do so.'
      },
      {
        title: '7. Payments and transaction information',
        body: 'Nasdiya may record payment status, amount, plan, manual UPI reference, payer transaction ID, refund reference, receipt number, and related timestamps to support bookings, products, provider websites, subscriptions, ads, boosts, verification, receipts, refunds, and dispute handling.\nCard, net banking, UPI app, wallet, or gateway credentials are handled by payment partners where applicable. Do not share UPI PINs, card PINs, passwords, or OTPs with Nasdiya, providers, or any other person.'
      },
      {
        title: '8. Cookies, analytics, and device data',
        body: 'We may use cookies, local storage, visitor IDs, logs, and similar technologies to keep sessions working, remember preferences, prevent abuse, understand traffic, measure page and profile views, and improve search, ads, and platform performance.\nYou may control browser cookies through your browser settings, but some features may not work correctly without essential storage.'
      },
      {
        title: '9. Security safeguards',
        body: 'We use reasonable technical and organisational safeguards such as password hashing, token-based sessions, OTP verification flows, access controls, admin role checks, upload handling, logging, and operational monitoring. We also limit public exposure of contact details where users choose privacy settings.\nNo online system is completely secure. You should use a strong password, protect OTPs, keep devices updated, and report suspicious activity promptly.'
      },
      {
        title: '10. Retention and deletion',
        body: 'We retain personal data for as long as needed to provide the platform, keep accounts active, complete bookings or transactions, support receipts and refunds, comply with law, resolve disputes, prevent fraud, enforce Terms, and maintain security.\nIf both sides delete a conversation, messages may be purged after a 30-day retention window. If a user account deletion request is scheduled, the platform may purge the account and related data after the deletion window, subject to lawful retention needs. Transaction, receipt, grievance, security, backup, and legal records may be retained for longer where required.'
      },
      {
        title: '11. Your privacy rights',
        body: 'Subject to applicable law, you may request access to personal data, correction, completion, updating, deletion or erasure, withdrawal of consent, grievance redressal, and nomination of another person to exercise rights in the event of death or incapacity.\nTo exercise rights, use available account settings or contact support@nasdiya.com from your registered email or mobile number. We may need to verify your identity before acting on a request.'
      },
      {
        title: '12. Children',
        body: 'Nasdiya is not intended for independent use by children under 18. If a child uses the platform, a parent or lawful guardian must supervise the use and provide any required consent. Providers must not knowingly collect or misuse children\'s personal data through Nasdiya.\nIf you believe a child has shared personal data without appropriate guardian involvement, contact support@nasdiya.com.'
      },
      {
        title: '13. Data transfers and processors',
        body: 'Some service providers may process or store data outside your city, state, or country, depending on hosting, email, storage, payment, analytics, and operational infrastructure. We use such processors for platform purposes and expect them to apply appropriate confidentiality and security safeguards.\nWhere Indian law restricts or regulates transfers, Nasdiya will take steps intended to comply with those requirements.'
      },
      {
        title: '14. Breach notification',
        body: 'If we become aware of a personal data breach that requires notification, we will take steps to assess, contain, and notify affected users and the appropriate authority as required by applicable Indian data protection law.\nUsers should promptly report suspected account compromise, unauthorized payment references, suspicious provider requests, or data misuse.'
      },
      {
        title: '15. Grievance contact',
        body: 'For privacy requests, account deletion, consent withdrawal, correction, data access, or grievance support, contact support@nasdiya.com. Include your registered email or mobile number, account role, relevant booking or transaction ID if any, and the specific request.\nWe aim to respond within the time required by applicable law and may ask for information needed to verify the request.'
      },
      {
        title: '16. Updates to this policy',
        body: 'Nasdiya may update this Privacy Policy as the platform, law, rules, or operational practices change. Material updates may be notified by email, in-app notice, public notice, or another reasonable method.\nThe effective date and version shown on this page identify the current policy.'
      }
    ]
  }
};

module.exports = {
  DEFAULT_LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_TYPES
};
