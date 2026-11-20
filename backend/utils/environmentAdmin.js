const crypto = require('crypto');

function environmentAdminIdentity() {
  const email = String(process.env.ADMIN_EMAIL || 'admin@scamsaver.local').trim().toLowerCase();
  const id = crypto.createHash('sha256').update(`scam-saver:environment-admin:${email}`).digest('hex').slice(0, 24);
  return {
    _id: id,
    name: process.env.ADMIN_NAME || 'Scam Saver Admin',
    email,
    role: 'admin',
    createdAt: null,
    avatar: '',
  };
}

module.exports = environmentAdminIdentity;
