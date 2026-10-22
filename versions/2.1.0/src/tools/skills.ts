import { arg, argOpt, type Tool } from "./registry.js";
import { listSkills, loadSkill, readSkillFile } from "../skills.js";

const ACTIONS = ["list", "load", "read"] as const;

/**
 * The way into `data/skills/`: a list, one procedure, or one file next to it.
 *
 * Loading is a *tool call* on purpose. It shows up in the chat log (so the user can
 * see which procedure the model decided to follow), it costs a step (so a small
 * model does not load five of them "just in case"), and it needs no approval because
 * it reads text and changes nothing.
 */
export const skillsTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "skills",
      description:
        "Load a procedure (a \"skill\") that the user installed: action \"list\" shows them, " +
        "\"load\" returns the steps of one, \"read\" returns a file that belongs to one. " +
        "Load a skill when the task matches its description, then follow its steps with the normal tools.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [...ACTIONS],
            description: "list (default), load, or read",
          },
          name: { type: "string", description: "The skill's name, as listed by action \"list\"." },
          path: {
            type: "string",
            description: 'For action "read": the file inside the skill folder, e.g. "examples.txt".',
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  },

  async run(args) {
    const raw = (argOpt(args, "action") ?? "list").trim().toLowerCase();
    const action = ACTIONS.find((entry) => entry === raw);
    if (!action) {
      return `Error: unknown action "${raw}". Use one of: ${ACTIONS.join(", ")}`;
    }

    if (action === "list") {
      const skills = listSkills();
      if (skills.length === 0) {
        return "No skills are installed. The user can add one in Settings -> Skills, or write data/skills/<name>/SKILL.md.";
      }
      return skills
        .map((skill) => {
          const when = skill.when ? `\n  when: ${skill.when}` : "";
          const problem = skill.problem ? `\n  problem: ${skill.problem}` : "";
          return `- ${skill.name}: ${skill.description}${when}\n  files: ${skill.files.join(", ")}${problem}`;
        })
        .join("\n");
    }

    if (action === "load") {
      const loaded = loadSkill(arg(args, "name"));
      if (typeof loaded === "string") return loaded;
      const others = loaded.skill.files.filter((file) => file !== "SKILL.md");
      const more = others.length > 0 ? `\n\n(other files: ${others.join(", ")} - read one with action "read")` : "";
      return `Skill "${loaded.skill.name}": ${loaded.skill.description}\n\n${loaded.body}${more}`;
    }

    return readSkillFile(arg(args, "name"), arg(args, "path"));
  },
};
