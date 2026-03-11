import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ── SOCIETY 1: Green Valley Apartments ──────────────────
  const society = await prisma.society.create({
    data: {
      name: 'Green Valley Apartments',
      address: '123, MG Road, Sector 15',
      city: 'Bangalore',
      state: 'Karnataka',
      pincode: '560001',
      registrationNo: 'KAR/SOC/2024/001',
      totalBlocks: 2,
      totalFlats: 20,
    },
  });

  console.log('✅ Society created:', society.name);

  // Create Blocks
  const blockA = await prisma.block.create({
    data: { name: 'A Wing', floors: 5, societyId: society.id },
  });

  const blockB = await prisma.block.create({
    data: { name: 'B Wing', floors: 5, societyId: society.id },
  });

  console.log('✅ Blocks created: A Wing, B Wing');

  // Create Super Admin
  const adminPassword = await bcrypt.hash('admin123', 12);
  const superAdmin = await prisma.user.create({
    data: {
      email: 'admin@greenvalley.com',
      passwordHash: adminPassword,
      name: 'System Administrator',
      phone: '9876543210',
      role: 'SUPER_ADMIN',
      societyId: society.id,
    },
  });

  console.log('✅ Super Admin created:', superAdmin.email);

  // Create Flats for Block A (A-101 to A-510)
  const flatTypes: Array<'ONE_BHK' | 'TWO_BHK' | 'THREE_BHK'> = ['ONE_BHK', 'TWO_BHK', 'THREE_BHK'];
  const flats = [];

  for (let floor = 1; floor <= 5; floor++) {
    for (let unit = 1; unit <= 2; unit++) {
      const flatNumber = `A-${floor}0${unit}`;
      const flat = await prisma.flat.create({
        data: {
          flatNumber,
          floor,
          type: flatTypes[(floor + unit) % 3],
          areaSqFt: 800 + (floor + unit) * 100,
          blockId: blockA.id,
          isOccupied: floor <= 3,
        },
      });
      flats.push(flat);
    }
  }

  // Create Flats for Block B
  for (let floor = 1; floor <= 5; floor++) {
    for (let unit = 1; unit <= 2; unit++) {
      const flatNumber = `B-${floor}0${unit}`;
      const flat = await prisma.flat.create({
        data: {
          flatNumber,
          floor,
          type: flatTypes[(floor + unit) % 3],
          areaSqFt: 900 + (floor + unit) * 100,
          blockId: blockB.id,
          isOccupied: floor <= 2,
        },
      });
      flats.push(flat);
    }
  }

  console.log(`✅ ${flats.length} flats created`);

  // Create Owners for occupied flats
  const ownerNames = [
    'Rajesh Kumar', 'Priya Sharma', 'Amit Patel', 'Sneha Reddy',
    'Vikram Singh', 'Kavitha Nair', 'Suresh Iyer', 'Deepa Gupta',
    'Manoj Joshi', 'Lakshmi Rao',
  ];

  const ownerPassword = await bcrypt.hash('owner123', 12);
  const occupiedFlats = flats.filter((f) => f.isOccupied);
  for (let i = 0; i < occupiedFlats.length; i++) {
    const ownerName = ownerNames[i % ownerNames.length];
    const ownerEmail = `${ownerName.toLowerCase().replace(' ', '.')}@email.com`;

    const ownerUser = await prisma.user.create({
      data: {
        email: ownerEmail,
        passwordHash: ownerPassword,
        name: ownerName,
        phone: `98765${String(43210 + i).padStart(5, '0')}`,
        role: 'OWNER',
        societyId: society.id,
      },
    });

    await prisma.owner.create({
      data: {
        name: ownerName,
        email: ownerEmail,
        phone: `98765${String(43210 + i).padStart(5, '0')}`,
        flatId: occupiedFlats[i].id,
        moveInDate: new Date('2024-01-15'),
        userId: ownerUser.id,
      },
    });
  }

  console.log(`✅ ${occupiedFlats.length} owners created (with login accounts)`);

  // Create a tenant
  if (occupiedFlats.length >= 2) {
    const tenantPassword = await bcrypt.hash('tenant123', 12);
    const tenantUser = await prisma.user.create({
      data: {
        email: 'ravi.menon@email.com',
        passwordHash: tenantPassword,
        name: 'Ravi Menon',
        phone: '9988776655',
        role: 'TENANT',
        societyId: society.id,
      },
    });

    await prisma.tenant.create({
      data: {
        name: 'Ravi Menon',
        email: 'ravi.menon@email.com',
        phone: '9988776655',
        flatId: occupiedFlats[1].id,
        leaseStart: new Date('2024-06-01'),
        leaseEnd: new Date('2025-05-31'),
        rentAmount: 15000,
        deposit: 45000,
        isActive: true,
        userId: tenantUser.id,
      },
    });

    console.log('✅ Tenant created');
  }

  // Create Maintenance Configs
  const configTypes: Array<'ONE_BHK' | 'TWO_BHK' | 'THREE_BHK'> = ['ONE_BHK', 'TWO_BHK', 'THREE_BHK'];
  for (const flatType of configTypes) {
    const baseAmounts = { ONE_BHK: 2000, TWO_BHK: 3000, THREE_BHK: 4500 };

    await prisma.maintenanceConfig.create({
      data: {
        societyId: society.id,
        flatType,
        baseAmount: baseAmounts[flatType],
        waterCharge: 300,
        parkingCharge: flatType === 'ONE_BHK' ? 500 : 1000,
        sinkingFund: 500,
        repairFund: 200,
        otherCharges: 0,
        lateFeePerDay: 50,
        dueDay: 10,
        isActive: true,
      },
    });
  }

  console.log('✅ Maintenance configs created');

  // Create sample expenses
  const expenseData: Array<{ category: 'SECURITY' | 'CLEANING' | 'ELECTRICITY' | 'LIFT' | 'GARDENING'; amount: number; description: string; vendor: string }> = [
    { category: 'SECURITY', amount: 25000, description: 'Security guard salary - Jan 2024', vendor: 'SecureGuard Services' },
    { category: 'CLEANING', amount: 15000, description: 'Common area cleaning - Jan 2024', vendor: 'CleanPro' },
    { category: 'ELECTRICITY', amount: 8000, description: 'Common area electricity bill', vendor: 'BESCOM' },
    { category: 'LIFT', amount: 5000, description: 'Lift maintenance quarterly', vendor: 'Otis Elevators' },
    { category: 'GARDENING', amount: 3000, description: 'Garden maintenance', vendor: 'GreenThumb' },
  ];

  for (const exp of expenseData) {
    await prisma.expense.create({
      data: {
        societyId: society.id,
        ...exp,
        expenseDate: new Date('2024-01-15'),
      },
    });
  }

  console.log('✅ Sample expenses created');

  // Create sample bylaws
  const bylaws = [
    { title: 'Quiet Hours', content: 'Residents must maintain silence between 10:00 PM and 7:00 AM. Music and loud noise are prohibited during these hours.', category: 'Noise', penaltyAmount: 500 },
    { title: 'Parking Rules', content: 'Each flat is allotted one parking slot. Visitors must park in designated visitor parking only. No parking in fire lanes.', category: 'Parking', penaltyAmount: 1000 },
    { title: 'Pet Policy', content: 'Pets must be leashed in common areas. Owners must clean up after their pets. Aggressive breeds require prior committee approval.', category: 'Pets', penaltyAmount: 500 },
    { title: 'Maintenance Payment', content: 'Monthly maintenance must be paid by the 10th of each month. A late fee of Rs 50/day will be charged after the due date.', category: 'General', penaltyAmount: null },
  ];

  for (const bylaw of bylaws) {
    await prisma.associationBylaw.create({
      data: {
        societyId: society.id,
        ...bylaw,
        effectiveDate: new Date('2024-01-01'),
        isActive: true,
      },
    });
  }

  console.log('✅ Association bylaws created');

  // ── SOCIETY 2: Sunrise Heights (demo of multi-tenancy) ──
  const society2 = await prisma.society.create({
    data: {
      name: 'Sunrise Heights',
      address: '456, Ring Road, HSR Layout',
      city: 'Bangalore',
      state: 'Karnataka',
      pincode: '560102',
      registrationNo: 'KAR/SOC/2024/002',
      totalBlocks: 1,
      totalFlats: 8,
    },
  });

  const adminPassword2 = await bcrypt.hash('admin123', 12);
  await prisma.user.create({
    data: {
      email: 'admin@sunriseheights.com',
      passwordHash: adminPassword2,
      name: 'Sunrise Admin',
      phone: '9876500000',
      role: 'ADMIN',
      societyId: society2.id,
    },
  });

  const block2A = await prisma.block.create({
    data: { name: 'Main Block', floors: 4, societyId: society2.id },
  });

  for (let floor = 1; floor <= 4; floor++) {
    for (let unit = 1; unit <= 2; unit++) {
      await prisma.flat.create({
        data: {
          flatNumber: `${floor}0${unit}`,
          floor,
          type: flatTypes[(floor + unit) % 3],
          areaSqFt: 850 + (floor + unit) * 100,
          blockId: block2A.id,
          isOccupied: false,
        },
      });
    }
  }

  console.log('✅ Society 2 (Sunrise Heights) created with admin & 8 flats');

  console.log('\n🎉 Seeding completed successfully!');
  console.log('\n📋 Login credentials:');
  console.log('   ┌───────────────────────────────────────────────────────────────┐');
  console.log('   │ GREEN VALLEY APARTMENTS                                       │');
  console.log('   │   Admin:  admin@greenvalley.com    / admin123                 │');
  console.log('   │   Owner:  rajesh.kumar@email.com   / owner123                 │');
  console.log('   │   Tenant: ravi.menon@email.com     / tenant123                │');
  console.log('   │                                                               │');
  console.log('   │ SUNRISE HEIGHTS                                               │');
  console.log('   │   Admin:  admin@sunriseheights.com / admin123                 │');
  console.log('   └───────────────────────────────────────────────────────────────┘');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
