import { PrismaClient } from "@/generated/prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding Diamond Exchange database...");

  // Create Super Admin
  const superAdminPwd = await bcrypt.hash("Admin@123", 10);
  const superAdmin = await prisma.user.upsert({
    where: { email: "superadmin@diamond.com" },
    update: {},
    create: {
      email: "superadmin@diamond.com",
      password: superAdminPwd,
      name: "Super Admin",
      role: "SUPER_ADMIN",
      wallet: { create: { balance: 1000000, exposure: 0 } },
    },
  });
  console.log("✅ Super Admin:", superAdmin.email);

  // Create Admin
  const adminPwd = await bcrypt.hash("Admin@123", 10);
  const admin = await prisma.user.upsert({
    where: { email: "admin@diamond.com" },
    update: {},
    create: {
      email: "admin@diamond.com",
      password: adminPwd,
      name: "Admin User",
      role: "ADMIN",
      parentId: superAdmin.id,
      wallet: { create: { balance: 500000, exposure: 0 } },
    },
  });
  console.log("✅ Admin:", admin.email);

  // Create Agent
  const agentPwd = await bcrypt.hash("Agent@123", 10);
  const agent = await prisma.user.upsert({
    where: { email: "agent@diamond.com" },
    update: {},
    create: {
      email: "agent@diamond.com",
      password: agentPwd,
      name: "Agent User",
      role: "AGENT",
      parentId: admin.id,
      wallet: { create: { balance: 100000, exposure: 0 } },
    },
  });
  console.log("✅ Agent:", agent.email);

  // Create User
  const userPwd = await bcrypt.hash("User@123", 10);
  const user = await prisma.user.upsert({
    where: { email: "user@diamond.com" },
    update: {},
    create: {
      email: "user@diamond.com",
      password: userPwd,
      name: "Test User",
      role: "USER",
      parentId: agent.id,
      wallet: { create: { balance: 10000, exposure: 0 } },
    },
  });
  console.log("✅ User:", user.email);

  // Create sample matches
  const match1 = await prisma.match.upsert({
    where: { id: "match-nfl-001" },
    update: {},
    create: {
      id: "match-nfl-001",
      teamA: "Tampa Bay Buccaneers",
      teamB: "Dallas Cowboys",
      sport: "American Football",
      status: "LIVE",
      startTime: new Date(),
      markets: {
        create: [
          {
            name: "Match Winner",
            status: "OPEN",
            runners: {
              create: [
                {
                  name: "Tampa Bay Buccaneers",
                  backOdds: 1.45,
                  layOdds: 1.47,
                },
                { name: "Dallas Cowboys", backOdds: 2.9, layOdds: 2.95 },
              ],
            },
          },
          {
            name: "Total Points O/U 45.5",
            status: "OPEN",
            runners: {
              create: [
                { name: "Over 45.5", backOdds: 1.91, layOdds: 1.93 },
                { name: "Under 45.5", backOdds: 1.91, layOdds: 1.93 },
              ],
            },
          },
        ],
      },
    },
  });
  console.log("✅ Match:", match1.teamA, "vs", match1.teamB);

  const match2 = await prisma.match.upsert({
    where: { id: "match-nba-001" },
    update: {},
    create: {
      id: "match-nba-001",
      teamA: "Los Angeles Lakers",
      teamB: "Boston Celtics",
      sport: "Basketball",
      status: "UPCOMING",
      startTime: new Date(Date.now() + 3600000),
      markets: {
        create: [
          {
            name: "Match Winner",
            status: "OPEN",
            runners: {
              create: [
                {
                  name: "Los Angeles Lakers",
                  backOdds: 2.1,
                  layOdds: 2.12,
                },
                { name: "Boston Celtics", backOdds: 1.78, layOdds: 1.8 },
              ],
            },
          },
        ],
      },
    },
  });
  console.log("✅ Match:", match2.teamA, "vs", match2.teamB);

  const match3 = await prisma.match.upsert({
    where: { id: "match-cricket-001" },
    update: {},
    create: {
      id: "match-cricket-001",
      teamA: "India",
      teamB: "Australia",
      sport: "Cricket",
      status: "UPCOMING",
      startTime: new Date(Date.now() + 7200000),
      markets: {
        create: [
          {
            name: "Match Winner",
            status: "OPEN",
            runners: {
              create: [
                { name: "India", backOdds: 1.65, layOdds: 1.67 },
                { name: "Australia", backOdds: 2.3, layOdds: 2.33 },
                { name: "Draw", backOdds: 4.5, layOdds: 4.6 },
              ],
            },
          },
        ],
      },
    },
  });
  console.log("✅ Match:", match3.teamA, "vs", match3.teamB);

  // Create casino games
  const games = [
    {
      name: "Teen Patti",
      slug: "teen-patti",
      category: "Card Games",
      launchUrl: "https://example.com/games/teen-patti",
      thumbnail: "https://placehold.co/300x400/1a1a28/f0b429?text=Teen+Patti",
    },
    {
      name: "Andar Bahar",
      slug: "andar-bahar",
      category: "Card Games",
      launchUrl: "https://example.com/games/andar-bahar",
      thumbnail: "https://placehold.co/300x400/1a1a28/1e88e5?text=Andar+Bahar",
    },
    {
      name: "Lucky 7",
      slug: "lucky-7",
      category: "Slots",
      launchUrl: "https://example.com/games/lucky-7",
      thumbnail: "https://placehold.co/300x400/1a1a28/00c853?text=Lucky+7",
    },
    {
      name: "Dragon Tiger",
      slug: "dragon-tiger",
      category: "Live Casino",
      launchUrl: "https://example.com/games/dragon-tiger",
      thumbnail: "https://placehold.co/300x400/1a1a28/e91e8c?text=Dragon+Tiger",
    },
    {
      name: "Roulette",
      slug: "roulette",
      category: "Live Casino",
      launchUrl: "https://example.com/games/roulette",
      thumbnail: "https://placehold.co/300x400/1a1a28/7c4dff?text=Roulette",
    },
    {
      name: "Blackjack",
      slug: "blackjack",
      category: "Live Casino",
      launchUrl: "https://example.com/games/blackjack",
      thumbnail: "https://placehold.co/300x400/1a1a28/f44336?text=Blackjack",
    },
    {
      name: "Aviator",
      slug: "aviator",
      category: "Crash Games",
      launchUrl: "https://example.com/games/aviator",
      thumbnail: "https://placehold.co/300x400/1a1a28/ff6b35?text=Aviator",
    },
    {
      name: "Mines",
      slug: "mines",
      category: "Crash Games",
      launchUrl: "https://example.com/games/mines",
      thumbnail: "https://placehold.co/300x400/1a1a28/00bcd4?text=Mines",
    },
  ];

  for (const game of games) {
    await prisma.game.upsert({
      where: { slug: game.slug },
      update: {},
      create: game,
    });
  }
  console.log("✅ Casino games created");

  // Create welcome notifications
  const allUsers = [superAdmin, admin, agent, user];
  for (const u of allUsers) {
    await prisma.notification.create({
      data: {
        userId: u.id,
        title: "Welcome to Diamond Exchange!",
        message:
          "Your account is ready. Start betting on your favorite sports.",
        type: "SUCCESS",
      },
    });
  }
  console.log("✅ Notifications created");

  console.log("\n🎉 Seeding complete!");
  console.log("\n📋 Test Credentials:");
  console.log("  Super Admin: superadmin@diamond.com / Admin@123");
  console.log("  Admin:       admin@diamond.com / Admin@123");
  console.log("  Agent:       agent@diamond.com / Agent@123");
  console.log("  User:        user@diamond.com / User@123");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
