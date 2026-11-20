const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
const User = require('./models/User');
const Business = require('./models/Business');
const Report = require('./models/Report');

const businessesData = [
  ['Northstar Gadgets', 'Mira Vale', 'Electronics', 'Portland, OR'],
  ['Cedar Lane Realty', 'Theo Finch', 'Real Estate', 'Austin, TX'],
  ['BrightPath Careers', 'Nia Brooks', 'Employment', 'Denver, CO'],
  ['Harborlight Exchange', 'Eli Rowan', 'Financial Services', 'Boston, MA'],
  ['Juniper Home Market', 'Sage Ellis', 'Home Goods', 'Madison, WI'],
  ['Orbit Mobile Deals', 'Remy Quinn', 'Electronics', 'Phoenix, AZ'],
  ['MapleKey Rentals', 'Ari Bell', 'Property', 'Raleigh, NC'],
  ['Bluebird Wellness', 'Noah Reed', 'Health & Wellness', 'Seattle, WA']
];

const fraudTypes = [
  'Online Shopping Fraud',
  'Property Fraud',
  'Job Fraud',
  'Payment Fraud',
  'Investment Fraud',
  'Identity Fraud',
  'Other',
  'Online Shopping Fraud',
  'Property Fraud',
  'Payment Fraud'
];

const statuses = [
  'Pending', 'Verified', 'Rejected', 'Pending', 'Verified',
  'Pending', 'Verified', 'Rejected', 'Pending', 'Verified'
];

async function seedDemoData() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is missing from your .env file.');
    }

    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB.');

    // Use an existing account. Do not delete or create users.
    const user = await User.findOne().sort({ createdAt: 1 });

    if (!user) {
      throw new Error('No user exists. Create an account before seeding demo data.');
    }

    const businesses = [];

    // Add businesses without replacing existing records.
    for (const [name, ownerName, category, location] of businessesData) {
      const business = await Business.findOneAndUpdate(
        { name, isDemo: true },
        {
          $setOnInsert: {
            name,
            ownerName,
            category,
            location,
            description:
              'Fictional demonstration business created for Scam Saver project testing. Not a real business.',
            isDemo: true
          }
        },
        { upsert: true, new: true }
      );

      businesses.push(business);
    }

    console.log(`Businesses ready: ${businesses.length}`);

    // Add reports with stable IDs so rerunning this script won't duplicate them.
    for (let i = 0; i < 10; i++) {
      const business = businesses[i % businesses.length];
      const reportId = `DEMO-SS-${String(i + 1).padStart(3, '0')}`;

      await Report.updateOne(
        { reportId },
        {
          $setOnInsert: {
            reportId,
            submittedBy: user._id,
            business: business._id,
            businessName: business.name,
            category: business.category,
            location: business.location,
            incidentDate: new Date(Date.now() - (i + 1) * 86400000),
            fraudType: fraudTypes[i],
            amount: i % 2 === 0 ? 125 + i * 40 : null,
            amountCurrency: 'INR',
            description:
              `Fictional demonstration report ${i + 1}. This sample is for demonstrating Scam Saver review workflows and is not a real allegation.`,
            contactEmail: user.email || '',
            status: statuses[i],
            adminNote:
              statuses[i] === 'Rejected'
                ? 'Demo rejection: insufficient supporting documentation.'
                : '',
            isDemo: true
          }
        },
        { upsert: true }
      );
    }

    console.log('Successfully added or checked 8 demo businesses and 10 demo reports.');
  } catch (error) {
    const authFailure = error.codeName === 'AuthenticationFailed' || /bad auth|authentication failed/i.test(error.message || '');
    console.error('Demo seed failed:', authFailure
      ? 'MongoDB authentication failed. Reset the database user password in MongoDB Atlas and update MONGODB_URI in your local .env.'
      : error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

seedDemoData();
