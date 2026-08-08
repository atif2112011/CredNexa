import nodemailer from "nodemailer";

import { env } from "../config/env.js";

const ADMIN_EMAIL = "atif251171@gmail.com";
const APPROVAL_MAIL_SUBJECT = "New key purchase request requires approval";
const PAYOUT_MAIL_SUBJECT = "New partner payout request requires approval";
const TEST_MAIL_SUBJECT = "EMI Shield email configuration test";

let transporter;

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const formatCurrency = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2
  }).format(Number(value || 0));

const formatDate = (value) => {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
};

const requireMailConfiguration = () => {
  const missing = [
    ["SMTP_HOST", env.smtpHost],
    ["SMTP_USER", env.smtpUser],
    ["SMTP_PASSWORD", env.smtpPassword],
    ["MAIL_FROM", env.mailFrom]
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    throw new Error(`Mail service is not configured. Missing: ${missing.join(", ")}`);
  }
};

const getTransporter = () => {
  requireMailConfiguration();

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      auth: {
        user: env.smtpUser,
        pass: env.smtpPassword
      }
    });
  }

  return transporter;
};

const buildEmailLayout = ({ heading, rows }) => `
  <div style="font-family: Arial, sans-serif; color: #202124; max-width: 640px; margin: 0 auto;">
    <h2 style="margin-bottom: 20px;">${escapeHtml(heading)}</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <tbody>
        ${rows
          .map(
            ([label, value]) => `
              <tr>
                <td style="padding: 10px; border: 1px solid #dadce0; font-weight: 600; width: 42%;">${escapeHtml(label)}</td>
                <td style="padding: 10px; border: 1px solid #dadce0;">${escapeHtml(value)}</td>
              </tr>`
          )
          .join("")}
      </tbody>
    </table>
    <p style="margin-top: 20px; color: #5f6368;">Please review this request in the EMI Shield admin application.</p>
  </div>`;

const buildApprovalMailBody = ({ creditPurchaseRequest, tenant }) =>
  buildEmailLayout({
    heading: "New key purchase request",
    rows: [
      ["Tenant", tenant?.name || "Not available"],
      ["Request ID", creditPurchaseRequest?._id?.toString() || "Not available"],
      ["Requested keys", creditPurchaseRequest?.requestedCredits ?? "Not available"],
      ["Price per key", formatCurrency(creditPurchaseRequest?.perKeyPrice)],
      ["Gross amount", formatCurrency(creditPurchaseRequest?.grossPurchaseAmount ?? creditPurchaseRequest?.purchaseAmount)],
      ["Discount", `${creditPurchaseRequest?.discountPercentage ?? 0}% (${formatCurrency(creditPurchaseRequest?.discountAmount || 0)})`],
      ["Amount paid", formatCurrency(creditPurchaseRequest?.purchaseAmount)],
      ["Payment reference", creditPurchaseRequest?.referenceNumber || "Not provided"],
      ["Requested at", formatDate(creditPurchaseRequest?.requestedAt || creditPurchaseRequest?.createdAt)]
    ]
  });

const buildPayoutMailBody = ({ payoutRequest, channelPartner }) =>
  buildEmailLayout({
    heading: "New partner payout request",
    rows: [
      ["Partner", channelPartner?.name || "Not available"],
      ["Request ID", payoutRequest?._id?.toString() || "Not available"],
      ["Payout amount", formatCurrency(payoutRequest?.amount)],
      ["UPI name", payoutRequest?.upiName || "Not available"],
      ["UPI ID", payoutRequest?.upiId || "Not available"],
      ["Requested at", formatDate(payoutRequest?.requestedAt || payoutRequest?.createdAt)]
    ]
  });

export const SendMail = async ({ to, body, subject }) => {
  if (!to || !subject || !body) {
    throw new Error("Mail recipient, subject, and body are required");
  }

  return getTransporter().sendMail({
    from: env.mailFrom,
    to,
    subject,
    html: body
  });
};

export const sendApprovalMail = ({ creditPurchaseRequest, tenant }) =>
  SendMail({
    to: ADMIN_EMAIL,
    subject: APPROVAL_MAIL_SUBJECT,
    body: buildApprovalMailBody({ creditPurchaseRequest, tenant })
  });

export const sendPayoutMail = ({ payoutRequest, channelPartner }) =>
  SendMail({
    to: ADMIN_EMAIL,
    subject: PAYOUT_MAIL_SUBJECT,
    body: buildPayoutMailBody({ payoutRequest, channelPartner })
  });

export const sendTestMail = () =>
  SendMail({
    to: ADMIN_EMAIL,
    subject: TEST_MAIL_SUBJECT,
    body: buildEmailLayout({
      heading: "Email configuration test successful",
      rows: [
        ["Service", "EMI Shield backend"],
        ["Status", "SMTP delivery is working"],
        ["Sent at", formatDate(new Date())]
      ]
    })
  });
