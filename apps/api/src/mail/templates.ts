/**
 * The academy's emails: a short plain-text version and a simple branded
 * HTML version of each. Names and other text from people are escaped.
 */
import { appUrl } from './mail.service.js';

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

const ACADEMY = 'Brightverse Academy';
const GREEN = '#1d6a50';

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function layout(opts: {
  title: string;
  lines: string[];
  button?: { label: string; url: string };
  after?: string[];
}): string {
  const p = (t: string) =>
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.5;color:#17211d">${t}</p>`;
  const button = opts.button
    ? `<p style="margin:22px 0"><a href="${esc(opts.button.url)}" style="display:inline-block;background:${GREEN};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px;font-size:15px">${esc(opts.button.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f6f6f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f2;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e3e4de;border-radius:12px">
<tr><td style="padding:24px 28px 8px"><img src="${esc(appUrl())}/brand/brightverse-logo-email.png" width="180" alt="${ACADEMY}" style="display:block;border:0"></td></tr>
<tr><td style="padding:12px 28px 24px;font-family:Arial,Helvetica,sans-serif">
<h1 style="margin:0 0 16px;font-size:20px;color:#17211d">${esc(opts.title)}</h1>
${opts.lines.map(p).join('\n')}${button}${(opts.after ?? []).map(p).join('\n')}
</td></tr></table>
<p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#57625c;margin:14px 0 0">${ACADEMY}</p>
</td></tr></table></body></html>`;
}

const text = (lines: string[]) => [...lines, '', `— ${ACADEMY}`].join('\n');

export function passwordResetEmail(
  name: string,
  link: string,
  minutes: number,
): EmailContent {
  return {
    subject: `Set a new password for ${ACADEMY}`,
    text: text([
      `Hi ${name},`,
      '',
      'Someone asked to set a new password for your account. Open this link to choose one:',
      link,
      '',
      `The link works once, for the next ${minutes} minutes. If it was not you, ignore this email; your password stays the same.`,
    ]),
    html: layout({
      title: 'Set a new password',
      lines: [
        `Hi ${esc(name)},`,
        'Someone asked to set a new password for your account. Choose one with the button below.',
      ],
      button: { label: 'Choose a new password', url: link },
      after: [
        `The link works once, for the next ${minutes} minutes. If it was not you, ignore this email; your password stays the same.`,
      ],
    }),
  };
}

export function lessonReminderEmail(o: {
  name: string;
  withName: string;
  when: string;
  zoneNote: string;
  link: string;
  minutes: number;
}): EmailContent {
  return {
    subject: `Your lesson with ${o.withName} starts in about ${o.minutes} minutes`,
    text: text([
      `Hi ${o.name},`,
      '',
      `Your lesson with ${o.withName} is at ${o.when} (${o.zoneNote}).`,
      `Enter class from the academy page, from 10 minutes before the start: ${o.link}`,
    ]),
    html: layout({
      title: `Lesson at ${o.when}`,
      lines: [
        `Hi ${esc(o.name)},`,
        `Your lesson with <strong>${esc(o.withName)}</strong> is at <strong>${esc(o.when)}</strong> (${esc(o.zoneNote)}).`,
      ],
      button: { label: 'Open Brightverse', url: o.link },
      after: ['"Enter class" opens 10 minutes before the start.'],
    }),
  };
}

export function invoiceEmail(o: {
  name: string;
  number: string;
  total: string;
  from: string;
  to: string;
  lessons: number;
  link: string;
  /** how families pay, from the academy settings */
  howToPay?: string | null;
}): EmailContent {
  return {
    subject: `Invoice ${o.number} from ${ACADEMY}: ${o.total}`,
    text: text([
      `Hi ${o.name},`,
      '',
      `Your invoice ${o.number} for ${o.from} to ${o.to} is ready: ${o.lessons} lessons, ${o.total}, paid in advance.`,
      `See it here: ${o.link}`,
      ...(o.howToPay ? ['', 'How to pay:', o.howToPay] : []),
    ]),
    html: layout({
      title: `Invoice ${o.number}`,
      lines: [
        `Hi ${esc(o.name)},`,
        `Your invoice for <strong>${esc(o.from)} to ${esc(o.to)}</strong> is ready: ${o.lessons} lessons, <strong>${esc(o.total)}</strong>, paid in advance.`,
      ],
      button: { label: 'See the invoice', url: o.link },
      after: o.howToPay
        ? [
            `<strong>How to pay</strong><br>${esc(o.howToPay).replace(/\n/g, '<br>')}`,
          ]
        : [],
    }),
  };
}

export function testEmail(): EmailContent {
  return {
    subject: `Test email from ${ACADEMY}`,
    text: text([
      'Email works. Students and teachers will get password links, lesson reminders and invoices from this address.',
    ]),
    html: layout({
      title: 'Email works',
      lines: [
        'Students and teachers will get password links, lesson reminders and invoices from this address.',
      ],
    }),
  };
}

export function lessonChangeEmail(o: {
  name: string;
  title: string;
  lines: string[];
  link: string;
}): EmailContent {
  return {
    subject: `${o.title} · ${ACADEMY}`,
    text: text([
      `Hi ${o.name},`,
      '',
      ...o.lines,
      '',
      `See your lessons: ${o.link}`,
    ]),
    html: layout({
      title: o.title,
      lines: [`Hi ${esc(o.name)},`, ...o.lines.map(esc)],
      button: { label: 'See your lessons', url: o.link },
    }),
  };
}

export function newRequestEmail(o: {
  name: string;
  who: string;
  what: string;
  when: string;
  message: string;
  link: string;
}): EmailContent {
  return {
    subject: `New request: ${o.who} asks to ${o.what} a lesson`,
    text: text([
      `Hi ${o.name},`,
      '',
      `${o.who} asks to ${o.what} the lesson on ${o.when} (Cairo time).`,
      `Their message: ${o.message}`,
      '',
      `Answer it here: ${o.link}`,
    ]),
    html: layout({
      title: `${o.who} asks to ${o.what} a lesson`,
      lines: [
        `Hi ${esc(o.name)},`,
        `<strong>${esc(o.who)}</strong> asks to ${o.what} the lesson on <strong>${esc(o.when)}</strong> (Cairo time).`,
        `Their message: ${esc(o.message)}`,
      ],
      button: { label: 'Answer the request', url: o.link },
    }),
  };
}

export function paymentReceivedEmail(o: {
  name: string;
  number: string;
  total: string;
  link: string;
}): EmailContent {
  return {
    subject: `Payment received for ${o.number} · ${ACADEMY}`,
    text: text([
      `Hi ${o.name},`,
      '',
      `Thank you: we received ${o.total} for invoice ${o.number}.`,
      `See it here: ${o.link}`,
    ]),
    html: layout({
      title: 'Payment received',
      lines: [
        `Hi ${esc(o.name)},`,
        `Thank you: we received <strong>${esc(o.total)}</strong> for invoice ${esc(o.number)}.`,
      ],
      button: { label: 'See the invoice', url: o.link },
    }),
  };
}

/** A short note with one button, e.g. homework sent or checked. */
export function noticeEmail(o: {
  name: string;
  title: string;
  lines: string[];
  button: string;
  link: string;
}): EmailContent {
  return {
    subject: `${o.title} · ${ACADEMY}`,
    text: text([`Hi ${o.name},`, '', ...o.lines, '', `${o.button}: ${o.link}`]),
    html: layout({
      title: o.title,
      lines: [`Hi ${esc(o.name)},`, ...o.lines.map(esc)],
      button: { label: o.button, url: o.link },
    }),
  };
}
