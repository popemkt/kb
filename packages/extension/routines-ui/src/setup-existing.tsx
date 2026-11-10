/**
 * The path for a Google Cloud project the person already has, set up and
 * published for something else: step 1 names it, its `existing` word counts
 * the steps up to the client done (`confirmedBy` in `@kb/routines` →
 * setup.ts), and the client step asks for kb's redirect URI on the client
 * that project already has, instead of a new client.
 */
import { useState, type ReactNode } from "react";
import { chooseProject, PROJECT_ID, type AccountSetup, type ProjectSource } from "@kb/routines";
import { cn } from "@kb/ui-sdk";
import { PRIMARY_BUTTON_CLASS } from "./dialog";
import { FIELD_CLASS } from "./repeat-picker";
import { consolePage } from "./setup-calls";
import { ConsoleLink, Field, Pick, WhatYouSee } from "./setup-parts";
import { runCalls } from "./writes";

const SOURCES: readonly { value: ProjectSource; label: string; detail: string }[] = [
  {
    value: "new",
    label: "Create a new project for kb",
    detail: "Eight steps, each linked to the Console page it needs.",
  },
  {
    value: "existing",
    label: "Use a project I already have",
    detail:
      "One with the Calendar API on, its app published and a Web OAuth client: you go straight to the client.",
  },
];

/** The choice between the two paths, as two radio cards. */
export function SourceChoice({
  value,
  onChange,
}: {
  readonly value: ProjectSource;
  readonly onChange: (source: ProjectSource) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">Which project</legend>
      {SOURCES.map((each) => (
        <label
          key={each.value}
          className={cn(
            "flex cursor-pointer items-start gap-2 rounded-md border p-3 text-foreground",
            each.value === value
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/60",
          )}
        >
          <input
            type="radio"
            name="project-source"
            className="mt-1 accent-primary"
            checked={each.value === value}
            onChange={() => onChange(each.value)}
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-ui font-medium text-foreground">{each.label}</span>
            <span className="text-meta text-muted-foreground">{each.detail}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Step 1 for a project the person already has: its id, and what to check in it. */
export function ExistingProject({ setup }: { readonly setup: AccountSetup }) {
  const [project, setProject] = useState(setup.project);
  const valid = PROJECT_ID.test(project);
  const saved = setup.project === project && setup.confirmed.has("existing");
  const page = (path: string) => (valid ? consolePage(path, project) : null);
  return (
    <>
      <Field
        label="Project ID"
        hint="As the Console's project picker shows it. It can differ from the project's name."
      >
        <input
          className={cn(FIELD_CLASS, "font-mono")}
          value={project}
          spellCheck={false}
          aria-invalid={!valid}
          placeholder="my-project-123"
          onChange={(event) => setProject(event.target.value.trim().toLowerCase())}
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-label text-muted-foreground">Check in that project</h3>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-ui text-foreground marker:text-muted-foreground">
          <CheckItem href={page("apis/library/calendar-json.googleapis.com")} link="Open the API">
            The <Pick>Google Calendar API</Pick> is enabled.
          </CheckItem>
          <CheckItem href={page("auth/audience")} link="Open Audience">
            The app is published: Audience reads <Pick>In production</Pick>.
          </CheckItem>
          <CheckItem href={page("auth/clients")} link="Open Clients">
            It has a <Pick>Web application</Pick> OAuth client. The next step adds kb's redirect URI
            to it.
          </CheckItem>
        </ul>
      </div>
      <button
        type="button"
        className={cn(PRIMARY_BUTTON_CLASS, "w-fit")}
        disabled={!valid}
        onClick={() =>
          void runCalls([chooseProject(setup, project, "existing")], "Could not save it")
        }
      >
        {saved ? "Saved" : `Use ${valid ? project : "this project"}`}
      </button>
    </>
  );
}

/** One thing to check, with a link to the page it is on once the project id is valid. */
function CheckItem({
  href,
  link,
  children,
}: {
  readonly href: string | null;
  readonly link: string;
  readonly children: ReactNode;
}) {
  return (
    <li>
      {children}{" "}
      {href === null ? null : (
        <a
          className="text-primary hover:underline"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {link}
        </a>
      )}
    </li>
  );
}

/** The client step's guide for a project that has its client already. */
export function ExistingClientGuide({ setup }: { readonly setup: AccountSetup }) {
  return (
    <>
      <ConsoleLink href={consolePage("auth/clients", setup.project)}>Open Clients</ConsoleLink>
      <WhatYouSee>
        <li>
          Your project's OAuth clients. Open the <Pick>Web application</Pick> one kb will use.
        </li>
        <li>
          Under <Pick>Authorized redirect URIs</Pick>, press <Pick>Add URI</Pick>, paste the URI
          below exactly, and press <Pick>Save</Pick>. The client's other URIs stay as they are.
        </li>
        <li>
          Copy its <Pick>Client ID</Pick> and its client secret into the fields below. If you don't
          have the secret any more, the client's page is where Google lets you add one.
        </li>
      </WhatYouSee>
    </>
  );
}
