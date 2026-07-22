// Built-in content for the Biddaro Safety app.
// Served read-only; talks/audits snapshot this content into their own JSON,
// so editing these constants never breaks historical records.

export interface SafetyTopic {
  key: string;
  title: string;
  icon: string; // emoji shown in the app's topic picker
  points: string[];
}

export const SAFETY_TOPICS: SafetyTopic[] = [
  {
    key: 'working_at_height',
    title: 'Working at Height',
    icon: '🪜',
    points: [
      'Always wear a full-body harness above 2 metres and anchor it to a firm point.',
      'Check ladders and scaffolds before use — no broken rungs, loose planks, or missing ties.',
      'Never stand on the top two rungs of a ladder or on scaffold guardrails.',
      'Keep both hands free while climbing — hoist tools up with a rope or bag.',
      'Barricade the area below and never throw material down from height.',
      'Do not work at height in strong wind or rain.',
    ],
  },
  {
    key: 'electrical',
    title: 'Electrical Safety',
    icon: '⚡',
    points: [
      'Only licensed electricians may work on electrical connections.',
      'Check cables for cuts and damaged insulation before every use.',
      'Keep cables off wet floors and walkways — hang them overhead where possible.',
      'Use ELCB/RCCB-protected distribution boards on site.',
      'Never overload a socket or joint wires with bare tape.',
      'Switch off and lock the supply before repairing any machine.',
    ],
  },
  {
    key: 'excavation',
    title: 'Excavation & Trenching',
    icon: '⛏️',
    points: [
      'Locate underground utilities (cables, water, gas) before digging.',
      'Slope, bench, or shore any trench deeper than 1.5 metres.',
      'Keep excavated soil at least 1 metre away from the trench edge.',
      'Provide safe access — a ladder within 7.5 metres of every worker.',
      'Barricade open excavations and mark them with warning lights at night.',
      'Never work alone in a deep trench.',
    ],
  },
  {
    key: 'fire',
    title: 'Fire Safety',
    icon: '🔥',
    points: [
      'Know where the nearest fire extinguisher is and how to use it (PASS: Pull, Aim, Squeeze, Sweep).',
      'Keep flammable materials (diesel, paint, thinner, LPG) stored away from hot work.',
      'Obtain a hot-work clearance before any welding, cutting, or grinding near combustibles.',
      'Never block escape routes or fire equipment with material.',
      'No smoking except in designated areas.',
      'Report empty or damaged extinguishers immediately.',
    ],
  },
  {
    key: 'ppe',
    title: 'PPE — Personal Protective Equipment',
    icon: '⛑️',
    points: [
      'Helmet, safety shoes, and high-visibility vest are mandatory on site at all times.',
      'Wear gloves suited to the task — cut-resistant for rebar, rubber for chemicals.',
      'Use safety goggles for grinding, chipping, and drilling.',
      'Use ear protection near compressors, breakers, and generators.',
      'Use a dust mask when cutting, sanding, or mixing cement.',
      'Damaged PPE must be replaced immediately — report it to your supervisor.',
    ],
  },
  {
    key: 'manual_lifting',
    title: 'Manual Lifting & Material Handling',
    icon: '🏋️',
    points: [
      'Bend your knees, keep your back straight, and hold the load close to your body.',
      'Ask for help or use a trolley for anything heavier than 25 kg.',
      'Check the path is clear before carrying a load.',
      'Never lift and twist at the same time — turn with your feet.',
      'Stack materials on firm, level ground, and never above shoulder height.',
      'Watch for pinch points when lowering loads.',
    ],
  },
  {
    key: 'scaffolding',
    title: 'Scaffolding Safety',
    icon: '🏗️',
    points: [
      'Only trained crews may erect, alter, or dismantle scaffolding.',
      'Every scaffold must rest on base plates — never on bricks or blocks.',
      'Platforms must be fully planked with guardrails and toe boards.',
      'Check the scaffold tag before climbing — do not use a red-tagged scaffold.',
      'Never overload platforms with stacked material.',
      'Do not modify or remove ties, braces, or guardrails.',
    ],
  },
  {
    key: 'housekeeping',
    title: 'Housekeeping',
    icon: '🧹',
    points: [
      'A clean site is a safe site — clear your work area at the end of every shift.',
      'Keep walkways, stairs, and ramps free of material and debris.',
      'Remove or bend over protruding nails in timber immediately.',
      'Stack rebar, pipes, and shuttering in designated areas only.',
      'Clean up spills (oil, water, paint) as soon as they happen.',
      'Dispose of waste in the correct bins — do not burn waste on site.',
    ],
  },
  {
    key: 'monsoon',
    title: 'Monsoon & Wet-Weather Safety',
    icon: '🌧️',
    points: [
      'Stop crane and height work during heavy rain or lightning.',
      'Check all electrical connections and DBs for water ingress daily.',
      'Watch for slippery surfaces — clean mud from walkways and ladders.',
      'Inspect excavations after every rain for collapse risk before entering.',
      'Ensure dewatering pumps are working and pits are barricaded.',
      'Beware of snakes and insects sheltering in material stacks.',
    ],
  },
  {
    key: 'machinery',
    title: 'Plant & Machinery',
    icon: '🚜',
    points: [
      'Only authorized operators may run machines — no exceptions.',
      'Walk around the machine and check it before starting (daily pre-use check).',
      'Stay out of the swing radius of excavators and cranes.',
      'Use a banksman/signaller when reversing vehicles.',
      'Never carry passengers on machines not designed for them.',
      'Switch off and remove the key before any repair or refuelling.',
    ],
  },
  {
    key: 'confined_space',
    title: 'Confined Spaces',
    icon: '🕳️',
    points: [
      'Never enter a tank, sump, manhole, or deep pit without a permit.',
      'Test the air before entry — oxygen, toxic, and flammable gases.',
      'Always have a standby person at the entrance who never enters.',
      'Wear a rescue harness with a lifeline attached.',
      'Ventilate the space continuously while anyone is inside.',
      'If you feel dizzy, get out immediately and report it.',
    ],
  },
  {
    key: 'heat_stress',
    title: 'Heat Stress',
    icon: '☀️',
    points: [
      'Drink water every 20–30 minutes — do not wait until you feel thirsty.',
      'Take rest breaks in shade during peak afternoon heat.',
      'Watch teammates for dizziness, cramps, or confusion — these are danger signs.',
      'Wear light-coloured, loose cotton clothing under PPE where possible.',
      'Schedule heavy work for morning and evening hours in summer.',
      'Move anyone with heat stroke symptoms to shade and call for help immediately.',
    ],
  },
];

export interface SafetyTemplateItem {
  id: string;
  label: string;
}

export interface SafetyTemplateSection {
  section: string;
  items: SafetyTemplateItem[];
}

export interface SafetyDefaultTemplate {
  key: string;
  name: string;
  structure: SafetyTemplateSection[];
}

export const DEFAULT_AUDIT_TEMPLATES: SafetyDefaultTemplate[] = [
  {
    key: 'general_site_audit',
    name: 'General Site Safety Audit',
    structure: [
      {
        section: 'Scaffolding & Access',
        items: [
          { id: 'scaf_1', label: 'Scaffolds erected on base plates, level and stable' },
          { id: 'scaf_2', label: 'Platforms fully planked with guardrails and toe boards' },
          { id: 'scaf_3', label: 'Scaffold inspection tag present and current (green)' },
          { id: 'scaf_4', label: 'Ladders in good condition, secured, extending 1m above landing' },
          { id: 'scaf_5', label: 'Safe access/egress provided to all work areas' },
        ],
      },
      {
        section: 'Edges & Openings',
        items: [
          { id: 'edge_1', label: 'Floor edges protected with guardrails or barricades' },
          { id: 'edge_2', label: 'Floor openings / shafts covered or barricaded and marked' },
          { id: 'edge_3', label: 'Stairwells provided with handrails' },
          { id: 'edge_4', label: 'Workers at unprotected edges using harnesses, anchored' },
        ],
      },
      {
        section: 'Electrical',
        items: [
          { id: 'elec_1', label: 'Distribution boards protected with ELCB/RCCB' },
          { id: 'elec_2', label: 'Cables in good condition — no cuts, joints taped properly' },
          { id: 'elec_3', label: 'Cables routed off walkways and wet areas' },
          { id: 'elec_4', label: 'No overloaded sockets or makeshift connections' },
        ],
      },
      {
        section: 'Housekeeping',
        items: [
          { id: 'hk_1', label: 'Walkways and stairs clear of material and debris' },
          { id: 'hk_2', label: 'Materials stacked safely in designated areas' },
          { id: 'hk_3', label: 'Protruding nails/rebar removed, bent, or capped' },
          { id: 'hk_4', label: 'Waste segregated and removed regularly' },
          { id: 'hk_5', label: 'Spills cleaned promptly, no standing water in work areas' },
        ],
      },
      {
        section: 'PPE',
        items: [
          { id: 'ppe_1', label: 'All workers wearing helmets and safety shoes' },
          { id: 'ppe_2', label: 'High-visibility vests worn where required' },
          { id: 'ppe_3', label: 'Task-specific PPE in use (goggles, gloves, masks, ear protection)' },
          { id: 'ppe_4', label: 'PPE in serviceable condition' },
        ],
      },
      {
        section: 'Fire Safety',
        items: [
          { id: 'fire_1', label: 'Fire extinguishers available, accessible, and in date' },
          { id: 'fire_2', label: 'Flammables stored correctly away from hot work' },
          { id: 'fire_3', label: 'Hot work performed with clearance and a fire watch' },
          { id: 'fire_4', label: 'Escape routes clear and known to workers' },
        ],
      },
      {
        section: 'Plant & Machinery',
        items: [
          { id: 'mach_1', label: 'Machines operated by authorized operators only' },
          { id: 'mach_2', label: 'Daily pre-use checks recorded for machines' },
          { id: 'mach_3', label: 'Moving-part guards fitted and in place' },
          { id: 'mach_4', label: 'Banksman used for reversing/lifting operations' },
        ],
      },
    ],
  },
  {
    key: 'daily_walkthrough',
    name: 'Daily Site Walkthrough',
    structure: [
      {
        section: 'Quick Checks',
        items: [
          { id: 'dw_1', label: 'Access routes and walkways clear' },
          { id: 'dw_2', label: 'Edge protection and barricades in place' },
          { id: 'dw_3', label: 'Workers wearing required PPE' },
          { id: 'dw_4', label: 'Electrical panels and cables safe' },
          { id: 'dw_5', label: 'No unattended open excavations or openings' },
          { id: 'dw_6', label: 'Fire extinguisher accessible' },
          { id: 'dw_7', label: 'Housekeeping acceptable in active work areas' },
          { id: 'dw_8', label: 'Toolbox talk conducted today' },
        ],
      },
    ],
  },
];
