import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ─── Clear existing data ──────────────────────────────────────────────────
  await prisma.notification.deleteMany();
  await prisma.message.deleteMany();
  await prisma.review.deleteMany();
  await prisma.dispute.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.bid.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.job.deleteMany();
  await prisma.user.deleteMany();

  const hash = await bcrypt.hash('password123', 12);

  // ─── Create users ─────────────────────────────────────────────────────────
  const [alice, bob, carol, dave, eve, frank] = await Promise.all([
    prisma.user.create({ data: {
      email: 'alice@example.com', passwordHash: hash,
      firstName: 'Alice', lastName: 'Johnson', role: 'job_poster',
      phone: '+1 (555) 100-0001', location: 'New York, NY',
      isVerified: true, isActive: true, rating: 4.8,
      bio: 'Real estate developer with 15+ years of experience in residential projects.',
    }}),
    prisma.user.create({ data: {
      email: 'bob@example.com', passwordHash: hash,
      firstName: 'Bob', lastName: 'Smith', role: 'contractor',
      phone: '+1 (555) 100-0002', location: 'Brooklyn, NY',
      isVerified: true, isActive: true, rating: 4.9, yearsExperience: 12,
      licenseNumber: 'NY-GC-2024-001',
      skills: JSON.stringify(['Framing', 'Drywall', 'Electrical', 'Plumbing', 'Roofing']),
      bio: 'Licensed general contractor specializing in residential renovations and new construction.',
    }}),
    prisma.user.create({ data: {
      email: 'carol@example.com', passwordHash: hash,
      firstName: 'Carol', lastName: 'Williams', role: 'contractor',
      phone: '+1 (555) 100-0003', location: 'Queens, NY',
      isVerified: true, isActive: true, rating: 4.7, yearsExperience: 8,
      licenseNumber: 'NY-ELEC-2024-042',
      skills: JSON.stringify(['Electrical Wiring', 'Panel Upgrades', 'EV Charger Installation', 'Code Compliance']),
      bio: 'Licensed master electrician. Residential and commercial projects.',
    }}),
    prisma.user.create({ data: {
      email: 'dave@example.com', passwordHash: hash,
      firstName: 'Dave', lastName: 'Martinez', role: 'contractor',
      phone: '+1 (555) 100-0004', location: 'The Bronx, NY',
      isVerified: true, isActive: true, rating: 4.6, yearsExperience: 6,
      skills: JSON.stringify(['Tile Work', 'Hardwood Flooring', 'Laminate', 'Bathroom Remodeling']),
      bio: 'Flooring and tile specialist with attention to detail.',
    }}),
    prisma.user.create({ data: {
      email: 'eve@example.com', passwordHash: hash,
      firstName: 'Eve', lastName: 'Chen', role: 'job_poster',
      phone: '+1 (555) 100-0005', location: 'Manhattan, NY',
      isVerified: true, isActive: true, rating: 4.5,
      bio: 'Property manager overseeing multiple residential units in Manhattan.',
    }}),
    prisma.user.create({ data: {
      email: 'frank@example.com', passwordHash: hash,
      firstName: 'Frank', lastName: 'Davis', role: 'contractor',
      phone: '+1 (555) 100-0006', location: 'Staten Island, NY',
      isVerified: false, isActive: true, rating: 4.3, yearsExperience: 4,
      skills: JSON.stringify(['Painting', 'Drywall Repair', 'Cabinet Installation']),
      bio: 'Reliable painter and finisher. Competitive rates.',
    }}),
  ]);

  // ─── Create wallets ───────────────────────────────────────────────────────
  await Promise.all([
    prisma.wallet.create({ data: { userId: alice.id, balance: 5000, pendingBalance: 0, totalEarned: 0 } }),
    prisma.wallet.create({ data: { userId: bob.id, balance: 12500, pendingBalance: 2000, totalEarned: 48000 } }),
    prisma.wallet.create({ data: { userId: carol.id, balance: 8200, pendingBalance: 0, totalEarned: 32000 } }),
    prisma.wallet.create({ data: { userId: dave.id, balance: 3100, pendingBalance: 500, totalEarned: 18000 } }),
    prisma.wallet.create({ data: { userId: eve.id, balance: 2000, pendingBalance: 0, totalEarned: 0 } }),
    prisma.wallet.create({ data: { userId: frank.id, balance: 800, pendingBalance: 0, totalEarned: 6000 } }),
  ]);

  // ─── Create jobs ──────────────────────────────────────────────────────────
  const [job1, job2, job3, job4, job5] = await Promise.all([
    prisma.job.create({ data: {
      posterId: alice.id, title: 'Kitchen Renovation - Full Remodel',
      description: 'Looking for an experienced contractor to completely renovate my kitchen. Work includes new cabinets, countertops, flooring, and appliance installation. The kitchen is approximately 200 sq ft.',
      category: 'Renovation', location: 'New York, NY',
      budget: 25000, budgetType: 'fixed', status: 'open',
      skills: JSON.stringify(['Carpentry', 'Plumbing', 'Electrical']),
      startDate: new Date('2024-04-01'), endDate: new Date('2024-05-15'),
      viewCount: 142,
    }}),
    prisma.job.create({ data: {
      posterId: alice.id, title: 'Bathroom Tile Installation',
      description: 'Need professional tile installation for master bathroom. Approx 80 sq ft floor + 60 sq ft shower walls. Tiles will be provided by homeowner.',
      category: 'Flooring', location: 'New York, NY',
      budget: 4500, budgetType: 'fixed', status: 'in_progress',
      skills: JSON.stringify(['Tile Work', 'Grouting']),
      startDate: new Date('2024-03-10'),
      viewCount: 89,
    }}),
    prisma.job.create({ data: {
      posterId: eve.id, title: 'Electrical Panel Upgrade - 200 Amp Service',
      description: 'Upgrading from 100A to 200A electrical service. Includes new panel, meter socket, and grounding system. Must be licensed electrician.',
      category: 'Electrical', location: 'Manhattan, NY',
      budget: 3800, budgetType: 'fixed', status: 'open',
      skills: JSON.stringify(['Electrical', 'Panel Upgrades', 'Code Compliance']),
      startDate: new Date('2024-04-15'),
      viewCount: 67,
    }}),
    prisma.job.create({ data: {
      posterId: eve.id, title: 'Hardwood Floor Refinishing - 3 Bedroom Apt',
      description: 'Sand and refinish approx 900 sq ft of existing oak hardwood floors. Floors have significant wear in high-traffic areas. Need oil-based finish.',
      category: 'Flooring', location: 'Manhattan, NY',
      budget: 6000, budgetType: 'fixed', status: 'completed',
      skills: JSON.stringify(['Hardwood Flooring', 'Floor Refinishing']),
      startDate: new Date('2024-01-15'), endDate: new Date('2024-02-01'),
      viewCount: 203,
    }}),
    prisma.job.create({ data: {
      posterId: alice.id, title: 'Interior Painting - 4 Room Apartment',
      description: 'Full interior paint job for 4-room apartment (~1100 sq ft). Two coats required. Homeowner will select paint colors. Painter must supply all materials.',
      category: 'Painting', location: 'New York, NY',
      budget: 2800, budgetType: 'fixed', status: 'open',
      skills: JSON.stringify(['Interior Painting', 'Surface Prep']),
      startDate: new Date('2024-04-20'),
      viewCount: 55,
    }}),
  ]);

  // ─── Create bids ──────────────────────────────────────────────────────────
  const [bid1, bid2, bid3, bid4] = await Promise.all([
    prisma.bid.create({ data: {
      jobId: job1.id, contractorId: bob.id,
      amount: 23500, estimatedDays: 45,
      proposal: 'I have completed 50+ kitchen renovations in the NYC area. I will handle all aspects including demo, framing, electrical rough-in coordination, plumbing rough-in coordination, cabinet installation, countertop fitting, and final trim work. References available upon request.',
      status: 'pending',
    }}),
    prisma.bid.create({ data: {
      jobId: job1.id, contractorId: dave.id,
      amount: 21000, estimatedDays: 50,
      proposal: 'Experienced renovation contractor with competitive pricing. My team can handle the full scope of work efficiently.',
      status: 'pending',
    }}),
    // Accepted bid for job2 (in_progress)
    prisma.bid.create({ data: {
      jobId: job2.id, contractorId: dave.id,
      amount: 4200, estimatedDays: 5,
      proposal: 'Tile is my specialty. I will ensure precise layout, proper waterproofing in the shower area, and perfect grout lines. 5-year workmanship warranty included.',
      status: 'accepted',
    }}),
    prisma.bid.create({ data: {
      jobId: job3.id, contractorId: carol.id,
      amount: 3600, estimatedDays: 3,
      proposal: 'Licensed master electrician with 20+ panel upgrades completed. I will pull all required permits and schedule inspection. Guaranteed code compliance.',
      status: 'pending',
    }}),
  ]);

  // ─── Create contracts ─────────────────────────────────────────────────────
  const milestones = JSON.stringify([
    { title: 'Demo & Prep', description: 'Remove existing tile and prep surfaces', amount: 800, status: 'completed', completedAt: new Date('2024-03-12').toISOString() },
    { title: 'Waterproofing', description: 'Apply waterproof membrane in shower', amount: 600, status: 'completed', completedAt: new Date('2024-03-14').toISOString() },
    { title: 'Floor Tile Installation', description: 'Install floor tiles with proper layout', amount: 1400, status: 'in_progress' },
    { title: 'Shower Wall Tile', description: 'Install shower wall tiles', amount: 1000, status: 'pending' },
    { title: 'Grouting & Sealing', description: 'Apply grout and sealer, final cleanup', amount: 400, status: 'pending' },
  ]);

  const contract1 = await prisma.contract.create({ data: {
    jobId: job2.id, bidId: bid3.id,
    posterId: alice.id, contractorId: dave.id,
    totalAmount: 4200, currency: 'USD',
    status: 'active',
    milestones,
    signedByPoster: new Date('2024-03-09'),
    signedByContractor: new Date('2024-03-09'),
  }});

  // Completed contract for job4
  const completedBid = await prisma.bid.create({ data: {
    jobId: job4.id, contractorId: dave.id,
    amount: 5800, estimatedDays: 10,
    proposal: 'Floor refinishing expert. 300+ floors refinished.',
    status: 'accepted',
  }});

  const contract2 = await prisma.contract.create({ data: {
    jobId: job4.id, bidId: completedBid.id,
    posterId: eve.id, contractorId: dave.id,
    totalAmount: 5800, currency: 'USD',
    status: 'completed',
    milestones: JSON.stringify([
      { title: 'Sanding', description: 'Sand all 900 sq ft', amount: 2000, status: 'completed' },
      { title: 'Staining & 1st Coat', description: 'Apply stain and first finish coat', amount: 2000, status: 'completed' },
      { title: 'Final Coat & Cleanup', description: 'Second coat and final cleanup', amount: 1800, status: 'completed' },
    ]),
    signedByPoster: new Date('2024-01-14'),
    signedByContractor: new Date('2024-01-14'),
    completedAt: new Date('2024-01-30'),
  }});

  // ─── Create reviews ───────────────────────────────────────────────────────
  await Promise.all([
    prisma.review.create({ data: {
      contractId: contract2.id, jobId: job4.id,
      reviewerId: eve.id, revieweeId: dave.id,
      rating: 5,
      comment: 'Dave did an outstanding job on our floors. The refinishing looks brand new. Showed up on time every day and cleaned up thoroughly. Will definitely hire again.',
    }}),
    // Note: Each contractId can only have one review per the unique constraint
    // The second review from dave would need a different approach - skipping for seed simplicity
  ]);

  // ─── Create messages ──────────────────────────────────────────────────────
  const msgs = [
    { senderId: alice.id, receiverId: bob.id, content: 'Hi Bob, I saw your bid on my kitchen project. Can we discuss the timeline?', jobId: job1.id },
    { senderId: bob.id, receiverId: alice.id, content: 'Hi Alice! Of course. I was thinking we could start with demo in early April. Does that work for you?', jobId: job1.id },
    { senderId: alice.id, receiverId: bob.id, content: 'That works. Do you handle the permit application or should I?', jobId: job1.id },
    { senderId: bob.id, receiverId: alice.id, content: 'I handle all permits as part of my service. I have a good relationship with the NYC DOB.', jobId: job1.id },
    { senderId: alice.id, receiverId: dave.id, content: 'Dave, great work on the tile prep! The floor layout looks perfect.', jobId: job2.id, contractId: contract1.id },
    { senderId: dave.id, receiverId: alice.id, content: 'Thanks Alice! Starting the actual tile installation tomorrow morning.', jobId: job2.id, contractId: contract1.id },
  ];

  for (const msg of msgs) {
    await prisma.message.create({ data: msg });
  }

  // ─── Create transactions ──────────────────────────────────────────────────
  await Promise.all([
    prisma.transaction.create({ data: {
      userId: dave.id, contractId: contract2.id,
      type: 'credit', amount: 5582.50,
      description: 'Payment for hardwood floor refinishing contract',
      status: 'completed',
    }}),
    prisma.transaction.create({ data: {
      userId: dave.id,
      type: 'fee', amount: 217.50,
      description: 'Platform fee (3.75%) - floor refinishing contract',
      status: 'completed',
    }}),
    prisma.transaction.create({ data: {
      userId: bob.id,
      type: 'credit', amount: 5000,
      description: 'Deposit via bank transfer',
      status: 'completed',
    }}),
  ]);

  // ─── Create notifications ─────────────────────────────────────────────────
  await Promise.all([
    prisma.notification.create({ data: {
      userId: alice.id, type: 'bid_received',
      title: 'New Bid Received',
      message: 'Bob Smith submitted a bid of $23,500 on your job "Kitchen Renovation - Full Remodel"',
      data: JSON.stringify({ jobId: job1.id, bidId: bid1.id }),
    }}),
    prisma.notification.create({ data: {
      userId: alice.id, type: 'bid_received',
      title: 'New Bid Received',
      message: 'Dave Martinez submitted a bid of $21,000 on your job "Kitchen Renovation - Full Remodel"',
      data: JSON.stringify({ jobId: job1.id, bidId: bid2.id }),
    }}),
    prisma.notification.create({ data: {
      userId: dave.id, type: 'bid_accepted',
      title: 'Bid Accepted! 🎉',
      message: 'Your bid of $4,200 for "Bathroom Tile Installation" has been accepted.',
      isRead: true,
      data: JSON.stringify({ jobId: job2.id, contractId: contract1.id }),
    }}),
  ]);

  console.log('\n✅ Seeded successfully:');
  console.log(`   6 users | 5 jobs | 5 bids | 2 contracts | 1 review | ${msgs.length} messages`);
  console.log('\n   Login credentials (all passwords: password123):');
  console.log('   alice@example.com  → Job Poster');
  console.log('   bob@example.com    → Contractor');
  console.log('   carol@example.com  → Contractor');
  console.log('   dave@example.com   → Contractor');
  console.log('   eve@example.com    → Job Poster');
  console.log('   frank@example.com  → Contractor');
}

main()
  .catch((e) => { console.error('Seed failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
