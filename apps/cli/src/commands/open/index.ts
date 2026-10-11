import { Command } from "commander";
import type { CommandContext } from "../../types.js";
import { loadCliState, parsedArgs, type SetExitCode } from "../shared.js";
import { runOpenCommand } from "./action.js";

export function createOpenCommand(
    context: CommandContext,
    setExitCode: SetExitCode,
): Command {
    return new Command("open")
        .description(
            "Open the web client of the selected instance in a browser",
        )
        .option("--instance <name>", "select a configured instance")
        .option("--docs", "open the management API documentation instead")
        .option("--print", "print the URL instead of opening a browser")
        .action(async (options) => {
            const { config } = await loadCliState(context);
            setExitCode(
                await runOpenCommand(
                    config,
                    parsedArgs("open", undefined, [], options),
                    context,
                ),
            );
        });
}
