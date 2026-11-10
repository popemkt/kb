/**
 * The Branding page step: the app's public pages and their domain, which
 * Google asks for before an External app can leave Testing. kb cannot see
 * the Console, so the step says what to fill, offers text for the pages, and
 * the person confirms it.
 */
import { consolePage } from "./setup-calls";
import { ConsoleLink, CopyValue, Pick, StepFrame, Verdict, WhatYouSee } from "./setup-parts";
import { Confirm, type StepProps } from "./setup-steps";

/** One install's pages, on GitHub Pages: what the four values look like. */
const EXAMPLE = {
  home: "https://popemkt.github.io/kb-routines-app/",
  privacy: "https://popemkt.github.io/kb-routines-app/privacy.html",
  terms: "https://popemkt.github.io/kb-routines-app/terms.html",
  domain: "popemkt.github.io",
} as const;

const homePage = (contact: string) => `kb routines

kb routines is a personal app. It keeps the routines in a kb knowledge base in step with Google Calendar, and runs on its owner's own computer for their own use.

With your permission it reads and changes the Google calendars you choose: it creates, updates and removes the events of your routines there, and nothing else.

Privacy policy: see privacy.html on this site.
Contact: ${contact}`;

const privacyPolicy = (contact: string) => `Privacy policy for kb routines

kb routines is a personal app, run for its owner's own use.

What it accesses: the Google calendars you choose, to create, update and remove the events of your routines.

Where your data goes: it stays on the computer that runs kb, and goes nowhere except back to Google Calendar. It is not sold or shared.

Google user data: kb routines' use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.

Removing access: remove the account in kb, or revoke access at https://myaccount.google.com/permissions.

Contact: ${contact}`;

const termsOfService = (contact: string) => `Terms of service for kb routines

kb routines is a personal app, provided as is and without warranty, for its owner's own use. Connecting a Google account lets it manage the events of your routines in the calendars you choose. You can revoke that access at any time.

Contact: ${contact}`;

/** Values to copy, each named beside it: what it is shown as, what copying it is called, it. */
function Labelled({ rows }: { readonly rows: readonly (readonly [string, string, string])[] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5">
      {rows.map(([shown, label, value]) => (
        <div key={label} className="contents">
          <dt className="pt-1.5 text-label text-muted-foreground">{shown}</dt>
          <dd className="min-w-0">
            <CopyValue label={label} value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function DomainStep({ setup, index }: StepProps) {
  const contact = setup.email === "" ? "your email address" : setup.email;
  return (
    <StepFrame
      index={index}
      title="Complete the Branding page"
      why={
        <>
          Google won't publish the app until its Branding page is complete. Testing keeps working
          meanwhile, but Google ends the connection after 7 days and you connect again. A published
          app doesn't expire, even unverified while fewer than 100 people use it.
        </>
      }
    >
      <ConsoleLink href={consolePage("auth/branding", setup.project)}>Open Branding</ConsoleLink>
      <WhatYouSee>
        <li>
          The app name, user support email and developer contact you gave in step {index - 1}.
        </li>
        <li>
          Fill these: <Pick>Application home page</Pick>,{" "}
          <Pick>Application privacy policy link</Pick>,{" "}
          <Pick>Application terms of service link</Pick>, and under <Pick>Authorized domains</Pick>{" "}
          the domain those pages are on. Then press <Pick>Save</Pick>.
        </li>
        <li>
          Leave <Pick>App logo</Pick> empty: an uploaded logo sends the app to Google's
          verification.
        </li>
      </WhatYouSee>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-label text-muted-foreground">The pages</h3>
        <p className="text-ui text-foreground">
          The home page and the privacy policy must be public pages on one domain, and that domain
          is the one you list under Authorized domains. A tailnet address (<code>*.ts.net</code>) or
          localhost won't work: Google has to reach the pages. Any free static host does, for
          example GitHub Pages, with an <code>index.html</code>, a <code>privacy.html</code> and a{" "}
          <code>terms.html</code>.
        </p>
        <p className="text-meta text-muted-foreground">
          Text to host, ready to copy. Check it says what you do, and change what doesn't.
        </p>
        <Labelled
          rows={[
            ["index.html", "Home page text", homePage(contact)],
            ["privacy.html", "Privacy policy text", privacyPolicy(contact)],
            ["terms.html", "Terms of service text", termsOfService(contact)],
          ]}
        />
      </div>
      <details className="flex flex-col gap-1.5 text-ui text-foreground">
        <summary className="cursor-pointer text-label text-muted-foreground">
          An example, optional: one install's pages on GitHub Pages
        </summary>
        <div className="mt-1.5 flex flex-col gap-1.5">
          <p className="text-meta text-muted-foreground">
            What the four values look like. Use your own pages; use these only if they are yours.
          </p>
          <Labelled
            rows={[
              ["Home page", "Home page", EXAMPLE.home],
              ["Privacy policy", "Privacy policy link", EXAMPLE.privacy],
              ["Terms of service", "Terms of service link", EXAMPLE.terms],
              ["Authorized domain", "Authorized domain", EXAMPLE.domain],
            ]}
          />
        </div>
      </details>
      <Verdict tone="note">
        kb can't see the Console, so it can't check this page. When it's saved, confirm it here.
      </Verdict>
      <Confirm setup={setup} step="domain">
        The Branding page is filled in
      </Confirm>
    </StepFrame>
  );
}
