import type { ReactNode } from "react";

// Public pages: no sign-in needed. The networks require these links before
// they let a developer app go live. Set VITE_OPERATOR_NAME and
// VITE_CONTACT_EMAIL in the host's environment variables.
const operator = (import.meta.env.VITE_OPERATOR_NAME as string | undefined) || "the operator of this site";
const contact = import.meta.env.VITE_CONTACT_EMAIL as string | undefined;

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <a href="/" className="text-sm font-bold tracking-tight">Rich Social</a>
      <h1 className="h1 mt-6">{title}</h1>
      <p className="mt-1 text-xs text-muted">Last updated November 17, 2026</p>
      <div className="mt-6 space-y-5 text-sm leading-relaxed [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-bold [&_li]:mt-1 [&_ul]:list-disc [&_ul]:pl-5">{children}</div>
      <p className="mt-10 border-t border-line pt-4 text-xs text-muted">
        <a className="hover:underline" href="/privacy">Privacy</a> · <a className="hover:underline" href="/terms">Terms</a>
      </p>
    </div>
  );
}

const Contact = () =>
  contact ? <a className="font-semibold text-gold hover:underline" href={`mailto:${contact}`}>{contact}</a> : <>the person who invited you</>;

export function Privacy() {
  return (
    <Page title="Privacy Policy">
      <p>Rich Social is a private tool for writing, scheduling, and publishing social media posts. It is run by {operator} for their own brands and invited team members. It is not open to the public.</p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Your account.</b> Your name and email address, provided through our sign-in provider, Clerk.</li>
        <li><b>Your content.</b> Posts, captions, images, videos, hashtag sets, templates, and schedules you create here.</li>
        <li><b>Connected social accounts.</b> When you connect an account (such as a Facebook Page, Instagram, Threads, LinkedIn, YouTube, TikTok, Pinterest, or Bluesky), we store that account's name, profile picture, ID, and the access token the network gives us.</li>
        <li><b>Activity.</b> A log of actions in your workspace, such as who scheduled or approved a post, and whether publishing worked.</li>
      </ul>

      <h2>How we use it</h2>
      <p>Only to run the tool: to show you your content, publish it to the accounts you choose at the times you choose, and tell you what happened. We do not sell your data, use it for advertising, or use it to train AI models.</p>

      <h2>Data from Google, Meta, TikTok, and other networks</h2>
      <ul>
        <li>We ask for the least access needed to publish on your behalf and to show which account is connected.</li>
        <li>For YouTube, we use the YouTube API Services to upload videos you choose and to read your channel's name and picture. We do not read your viewing history, comments, or other YouTube data. YouTube's own terms and the <a className="font-semibold text-gold hover:underline" href="https://policies.google.com/privacy" rel="noopener noreferrer" target="_blank">Google Privacy Policy</a> also apply.</li>
        <li>Rich Social's use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.</li>
        <li>Access tokens are encrypted before they are stored and are never sent to your browser.</li>
      </ul>

      <h2>Who else handles the data</h2>
      <ul>
        <li><b>Clerk</b> handles sign-in.</li>
        <li><b>Convex</b> stores the database and uploaded files.</li>
        <li><b>Netlify</b> serves the website.</li>
        <li><b>The social networks you connect</b> receive the posts and media you choose to publish to them.</li>
      </ul>
      <p>Uploaded media is stored at web addresses that are long and unguessable but not password protected, because the networks must be able to fetch the files to publish them.</p>

      <h2>Keeping and deleting data</h2>
      <ul>
        <li>You can delete posts and media at any time inside the tool.</li>
        <li>Disconnecting a social account deletes its stored access token right away. You can also remove this tool's access from within each network's own settings (for Google: <a className="font-semibold text-gold hover:underline" href="https://myaccount.google.com/permissions" rel="noopener noreferrer" target="_blank">myaccount.google.com/permissions</a>).</li>
        <li>To have your account and all of its data removed, contact <Contact />.</li>
      </ul>

      <h2>Changes and contact</h2>
      <p>If this policy changes, the date at the top changes with it. Questions go to <Contact />.</p>
    </Page>
  );
}

export function Terms() {
  return (
    <Page title="Terms of Service">
      <p>Rich Social is a private tool run by {operator}. By using it you agree to the following.</p>
      <h2>Using the tool</h2>
      <ul>
        <li>Access is by invitation. Keep your sign-in details to yourself.</li>
        <li>You are responsible for what you publish through it, and for having the right to publish it.</li>
        <li>Only connect social accounts you own or are authorized to manage.</li>
        <li>Follow the rules of each network you publish to, including the <a className="font-semibold text-gold hover:underline" href="https://www.youtube.com/t/terms" rel="noopener noreferrer" target="_blank">YouTube Terms of Service</a> when you connect a YouTube channel.</li>
        <li>Do not use the tool for spam, harassment, or anything unlawful.</li>
      </ul>
      <h2>No guarantees</h2>
      <p>The tool is provided as is. Networks change their rules and can reject or delay posts. A scheduled post may fail or go out late, so check anything time-critical. To the extent the law allows, the operator is not liable for losses from using the tool.</p>
      <h2>Ending access</h2>
      <p>You can stop using the tool at any time and ask for your data to be removed. The operator can remove access for anyone who breaks these terms.</p>
      <h2>Contact</h2>
      <p>Questions go to <Contact />.</p>
    </Page>
  );
}
