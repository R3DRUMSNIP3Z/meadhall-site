// backend/mailer.js
const nodemailer = require("nodemailer");

function makeTransport({ host, port, secure, user, pass }) {
  return nodemailer.createTransport({
    host,
    port,
    secure,                // true for 465, false for 587
    auth: { user, pass },
    pool: true,
    maxConnections: 3,
    maxMessages: 50,
    keepAlive: true,
    // Timeouts (ms)
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
    // Force IPv4 to avoid IPv6 timeouts on some hosts
    family: 4,
    // TLS options
    tls: {
      servername: host,
      rejectUnauthorized: true, // keep strict; your cert is Google’s
      // ciphers left default; Node will pick strong ones
    },
  });
}

async function getGmailTransport() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  // Try SMTPS 465 first (implicit TLS)
  let transporter = makeTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    user,
    pass,
  });
  try {
    await transporter.verify();
    return transporter;
  } catch (err465) {
    console.warn("[mailer] 465 verify failed, retrying 587 STARTTLS…", err465?.message);
    // Fallback to 587 (STARTTLS)
    transporter = makeTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false, // STARTTLS
      user,
      pass,
    });
    await transporter.verify(); // will throw if still broken
    return transporter;
  }
}

// Lazy, shared singleton so we don’t create pools repeatedly
let cachedTransport = null;

async function getTransport() {
  if (cachedTransport) return cachedTransport;
  cachedTransport = await getGmailTransport();
  return cachedTransport;
}

async function sendMail({ to, subject, text, html, from }) {
  const transporter = await getTransport();
  const info = await transporter.sendMail({
    from: from || process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    html,
  });
  return info;
}

module.exports = {
  sendMail,
  _getTransportForDebug: getTransport, // optional export for verify endpoints
};
