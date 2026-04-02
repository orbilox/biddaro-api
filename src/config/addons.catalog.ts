// ─── Add-Ons Catalog ─────────────────────────────────────────────────────────
//
// To add a new add-on in the future, just append an entry to ADDONS_CATALOG.
// No DB schema changes needed — only the UserAddOn.addOnSlug reference is stored.

export type AddOnCategory =
  | 'Productivity'
  | 'Finance'
  | 'Communication'
  | 'Trust & Safety'
  | 'Marketing'
  | 'Planning';

export type PricingType = 'free' | 'monthly' | 'one_time';

export type TargetRole = 'contractor' | 'job_poster' | 'both';

export interface AddOnDefinition {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: AddOnCategory;
  icon: string;           // emoji icon
  price: number;          // 0 for free
  pricingType: PricingType;
  targetRole: TargetRole;
  features: string[];     // bullet-point feature list
  isNew?: boolean;
  isPopular?: boolean;
  comingSoon?: boolean;
}

export const ADDONS_CATALOG: AddOnDefinition[] = [
  // ── Productivity ─────────────────────────────────────────────────────────
  {
    slug: 'time-tracker',
    name: 'Time Tracker',
    tagline: 'Track hours on every contract',
    description: 'Log and export work hours per milestone or contract. Generate time reports for clients and simplify invoicing.',
    category: 'Productivity',
    icon: '⏱️',
    price: 0,
    pricingType: 'free',
    targetRole: 'contractor',
    features: [
      'Start/stop timer per contract',
      'Manual hour entry',
      'Export CSV time reports',
      'Hourly summary per week',
    ],
    isPopular: true,
  },
  {
    slug: 'advanced-analytics',
    name: 'Advanced Analytics',
    tagline: 'Deep insights into earnings & performance',
    description: 'Visualize your earnings trends, win rates, and job performance with detailed charts and monthly reports.',
    category: 'Productivity',
    icon: '📊',
    price: 9.99,
    pricingType: 'monthly',
    targetRole: 'both',
    features: [
      'Earnings trend charts',
      'Bid win-rate analytics',
      'Job category breakdown',
      'Monthly summary reports',
      'Export to PDF/CSV',
    ],
    isNew: true,
  },

  // ── Finance ───────────────────────────────────────────────────────────────
  {
    slug: 'invoice-generator',
    name: 'Invoice Generator',
    tagline: 'Professional PDF invoices in one click',
    description: 'Generate branded PDF invoices for completed contracts. Send directly to clients or download for your records.',
    category: 'Finance',
    icon: '🧾',
    price: 0,
    pricingType: 'free',
    targetRole: 'contractor',
    features: [
      'PDF invoice generation',
      'Custom branding & logo',
      'Auto-filled from contract data',
      'Email invoice to client',
      'Invoice history archive',
    ],
    isPopular: true,
  },
  {
    slug: 'tax-report',
    name: 'Tax Report',
    tagline: 'Monthly tax summary for your earnings',
    description: 'Automatically summarize taxable earnings, deductible expenses, and generate a tax-ready report each month.',
    category: 'Finance',
    icon: '📋',
    price: 4.99,
    pricingType: 'monthly',
    targetRole: 'contractor',
    features: [
      'Monthly tax summary PDF',
      'Gross vs net earnings breakdown',
      'Deductible expense tracking',
      'Multi-currency support',
      'Annual tax report',
    ],
  },
  {
    slug: 'budget-tracker',
    name: 'Budget Tracker',
    tagline: 'Monitor project spend in real-time',
    description: 'Track project budgets, spending categories, and get alerts when you\'re approaching budget limits.',
    category: 'Finance',
    icon: '💰',
    price: 4.99,
    pricingType: 'monthly',
    targetRole: 'job_poster',
    features: [
      'Per-project budget dashboards',
      'Spend category breakdown',
      'Over-budget alerts',
      'Compare estimated vs actual spend',
    ],
    isNew: true,
  },

  // ── Communication ─────────────────────────────────────────────────────────
  {
    slug: 'sms-notifications',
    name: 'SMS Notifications',
    tagline: 'Get real-time alerts on your phone',
    description: 'Receive SMS alerts for new bids, contract updates, milestone approvals, and payment confirmations.',
    category: 'Communication',
    icon: '📱',
    price: 4.99,
    pricingType: 'monthly',
    targetRole: 'both',
    features: [
      'Bid & contract SMS alerts',
      'Payment received notifications',
      'Milestone update SMS',
      'Customizable alert preferences',
    ],
  },
  {
    slug: 'video-meetings',
    name: 'Video Meetings',
    tagline: 'Built-in video calls with clients',
    description: 'Schedule and host video calls directly within Biddaro without switching apps. Perfect for site walkthroughs and negotiations.',
    category: 'Communication',
    icon: '📹',
    price: 9.99,
    pricingType: 'monthly',
    targetRole: 'both',
    features: [
      'One-click video call links',
      'Schedule meetings from messages',
      'Screen sharing support',
      'Meeting history & recordings',
    ],
    comingSoon: true,
  },

  // ── Trust & Safety ────────────────────────────────────────────────────────
  {
    slug: 'e-signature',
    name: 'E-Signature',
    tagline: 'Legally binding digital signatures',
    description: 'Add digital signature blocks to contracts. Both parties sign electronically with a tamper-proof audit trail.',
    category: 'Trust & Safety',
    icon: '✍️',
    price: 0,
    pricingType: 'free',
    targetRole: 'both',
    features: [
      'Digital signature on contracts',
      'Audit trail & timestamp',
      'Legally binding in 180+ countries',
      'PDF signature certificate',
    ],
    isPopular: true,
  },
  {
    slug: 'background-check',
    name: 'Background Check',
    tagline: 'Verified contractor identity & history',
    description: 'Run a one-time background check to display a verified badge on your profile. Increases trust and wins more jobs.',
    category: 'Trust & Safety',
    icon: '🛡️',
    price: 29.99,
    pricingType: 'one_time',
    targetRole: 'contractor',
    features: [
      'Identity verification',
      'Criminal record check',
      'Verified badge on profile',
      'Valid for 2 years',
      'Report shared with job posters',
    ],
    isPopular: true,
  },
  {
    slug: 'insurance-verification',
    name: 'Insurance Verification',
    tagline: 'Show proof of liability insurance',
    description: 'Upload and verify your insurance certificate. Displays an Insurance Verified badge visible to all job posters.',
    category: 'Trust & Safety',
    icon: '📜',
    price: 0,
    pricingType: 'free',
    targetRole: 'contractor',
    features: [
      'Upload insurance certificate',
      'Document verification',
      'Insurance Verified badge on profile',
      'Expiry tracking & renewal reminder',
    ],
  },

  // ── Project Management ────────────────────────────────────────────────────
  {
    slug: 'project-manager',
    name: 'Project Manager',
    tagline: 'Full-featured project management OS for contractors',
    description: 'A complete project management workspace — create projects, manage tasks on a Kanban board, track milestones, collaborate in discussions, manage files, and log time. Everything you need to run your contracting business, all in one place.',
    category: 'Productivity',
    icon: '🗂️',
    price: 12.99,
    pricingType: 'monthly',
    targetRole: 'contractor',
    features: [
      'Kanban board: Todo, In Progress, In Review, Done',
      'Tasks with priorities, due dates & sub-tasks',
      'Milestones & sprint planning with roadmap',
      'Threaded discussions per project',
      'File & document management',
      'Time tracking with per-task logging',
      'Project overview dashboard with stats',
      'Link projects to Biddaro contracts',
    ],
    isNew: true,
    isPopular: true,
  },
  {
    slug: 'live-project-tracking',
    name: 'Live Project Tracking',
    tagline: 'Real-time progress dashboard for every contract',
    description: 'Contractors post live progress updates, photos, and completion percentages. Job posters get a live feed dashboard showing exactly where every project stands — no more chasing updates.',
    category: 'Productivity',
    icon: '📡',
    price: 7.99,
    pricingType: 'monthly',
    targetRole: 'both',
    features: [
      'Contractor posts progress updates with % completion',
      'Photo and note attachments on updates',
      'Job poster sees live feed per contract',
      'Visual progress bar per milestone',
      'All update history with timestamps',
      'Instant notification on new update',
    ],
    isNew: true,
    isPopular: true,
  },

  // ── Planning ──────────────────────────────────────────────────────────────
  {
    slug: 'construction-planner',
    name: 'Construction Planner',
    tagline: 'Full visual planning suite for your build',
    description: 'Plan every detail of your construction project — site mapping, interior/exterior design, plumbing, electrical, structural, and more. Upload images, build checklists, and earn achievement badges as you complete each phase. Generate a final Construction Blueprint report when you\'re done.',
    category: 'Planning',
    icon: '🏗️',
    price: 9.99,
    pricingType: 'monthly',
    targetRole: 'job_poster',
    features: [
      'Planning sections: site map, exterior, interior, plumbing, electrical, structural, HVAC, finishes',
      'Auto-populated trade checklists for each section',
      'Image & blueprint upload board per section',
      'Gamification: 8 achievement badges to earn',
      'Progress tracking across all sections',
      'Final Construction Blueprint report',
      'Multiple build plans (residential, commercial, renovation)',
      'Notes & annotations per section',
    ],
    isNew: true,
    isPopular: true,
  },

  // ── Marketing ─────────────────────────────────────────────────────────────
  {
    slug: 'featured-profile',
    name: 'Featured Profile',
    tagline: 'Appear at the top of contractor search',
    description: 'Get your profile featured prominently in job poster searches and recommendations for maximum visibility.',
    category: 'Marketing',
    icon: '⭐',
    price: 14.99,
    pricingType: 'monthly',
    targetRole: 'contractor',
    features: [
      'Top placement in search results',
      'Featured badge on profile',
      'Priority in AI recommendations',
      'Highlighted in category pages',
    ],
  },
  {
    slug: 'boost-bids',
    name: 'Bid Booster',
    tagline: 'Make your bids stand out to job posters',
    description: 'Your bids appear with a visual highlight and are shown first in the job poster\'s bid list for 7 days per boost.',
    category: 'Marketing',
    icon: '🚀',
    price: 9.99,
    pricingType: 'monthly',
    targetRole: 'contractor',
    features: [
      '5 bid boosts per month',
      'Highlighted position in bid list',
      'Boost badge visible to job poster',
      '7-day boost duration per bid',
    ],
    isNew: true,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getAddOn(slug: string): AddOnDefinition | undefined {
  return ADDONS_CATALOG.find((a) => a.slug === slug);
}

export const ADDON_CATEGORIES: AddOnCategory[] = [
  'Productivity',
  'Finance',
  'Communication',
  'Trust & Safety',
  'Marketing',
  'Planning',
];
