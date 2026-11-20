const mongoose = require('mongoose');
async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is missing. Copy .env.example to .env and configure MongoDB.');
  try { await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 }); console.log('MongoDB connected'); }
  catch (err) {
    if (err.codeName === 'AuthenticationFailed' || /bad auth|authentication failed/i.test(err.message || '')) {
      throw new Error('MongoDB authentication failed. Reset the password for the database user in MongoDB Atlas, URL-encode any reserved password characters, then update MONGODB_URI in your local .env and Render environment.');
    }
    throw new Error(`MongoDB connection failed: ${err.message}. Start MongoDB or configure MONGODB_URI in .env.`);
  }
}
module.exports = connectDB;
