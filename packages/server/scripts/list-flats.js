#!/usr/bin/env node
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async ()=>{
  const flats = await db.flat.findMany({ take: 10, include: { block: { select: { name: true } } } });
  console.log('Sample flats (id, flatNumber, block):');
  for (const f of flats) console.log(f.id, f.flatNumber, f.block?.name || 'unknown');
  await db.$disconnect();
})().catch(e=>{console.error(e);process.exit(1)});
