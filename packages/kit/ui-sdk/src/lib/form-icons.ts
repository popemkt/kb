/**
 * The icons a form names, by name (DESIGN-UI.md → The node menu): a node
 * command's, a picker step's and a field type's value kind. They are the
 * icons the shell's own rows already draw, so a name costs the page nothing
 * it does not carry.
 */
import {
  ArrowRightIcon,
  CheckIcon,
  EyeIcon,
  HashIcon,
  LinkSimpleIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  PushPinIcon,
  StarIcon,
  TextTIcon,
  TrashIcon,
  type Icon,
} from "@phosphor-icons/react";

const FORM_ICONS = {
  "arrow-right": ArrowRightIcon,
  check: CheckIcon,
  eye: EyeIcon,
  hash: HashIcon,
  link: LinkSimpleIcon,
  "magnifying-glass": MagnifyingGlassIcon,
  pin: PushPinIcon,
  plus: PlusIcon,
  star: StarIcon,
  text: TextTIcon,
  trash: TrashIcon,
} as const satisfies Record<string, Icon>;

/** An icon a form names: one of the shell's, drawn as the shell draws its own. */
export type IconName = keyof typeof FORM_ICONS;

/**
 * The icon `name` names, checked where the form is provided: a name kb does
 * not name throws, as a malformed contribution should.
 */
export function iconOf(owner: string, name: IconName): Icon {
  // Its own names only: a name such as `constructor` must not read through the prototype.
  if (!Object.hasOwn(FORM_ICONS, name)) throw new Error(`${owner}: "${name}" is no icon kb names`);
  return FORM_ICONS[name];
}
