const nodemailer = require('nodemailer');

let transporter;

function isEmailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function getTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env;
  if (!isEmailConfigured()) {
    const error = new Error('L’envoi des codes e-mail n’est pas configuré. Renseignez SMTP_HOST et SMTP_FROM.');
    error.statusCode = 503;
    throw error;
  }

  if (!transporter) {
    const port = Number(SMTP_PORT || 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('SMTP_PORT doit être un port valide.');
    }
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE === 'true',
      ...(SMTP_USER ? { auth: { user: SMTP_USER, pass: SMTP_PASSWORD || '' } } : {})
    });
  }
  return transporter;
}

async function sendVerificationEmail(email, code, purpose) {
  const subjects = {
    login_mfa: 'Votre code de connexion CSI Niger',
    password_change: 'Confirmation du changement de mot de passe CSI Niger',
    password_reset: 'Réinitialisation de votre mot de passe CSI Niger',
    mfa_setup: 'Activation de la double authentification CSI Niger',
    mfa_disable: 'Désactivation de la double authentification CSI Niger'
  };
  const subject = subjects[purpose];
  if (!subject) throw new Error('Type de code de vérification inconnu.');

  await getTransporter().sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject,
    text: `Votre code de vérification CSI Niger est : ${code}\n\nCe code expire dans 10 minutes. Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.`,
    html: `<p>Votre code de vérification CSI Niger est :</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>Ce code expire dans 10 minutes. Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.</p>`
  });
}

module.exports = { isEmailConfigured, sendVerificationEmail };
