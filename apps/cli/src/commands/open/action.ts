import {
    assertWebUrl,
    type BrowserLauncher,
    chooseLauncher,
    launchBrowser,
    pathLookup,
} from "../../services/browser.js";
import { resolveInstance } from "../../services/instance-selection.js";
import type { CliConfig, CommandContext, ParsedArgs } from "../../types.js";

export interface OpenDependencies {
    platform: NodeJS.Platform;
    launch: (launcher: BrowserLauncher) => Promise<boolean>;
}

const defaultDependencies: OpenDependencies = {
    platform: process.platform,
    launch: launchBrowser,
};

export function resolveOpenTarget(
    instanceName: string,
    instance: CliConfig["instances"][string],
    docs: boolean,
): string {
    if (docs) {
        // Resolve relative to the instance URL so a path prefix such as
        // https://example.com/eudiplo is kept.
        const base = instance.url.endsWith("/")
            ? instance.url
            : `${instance.url}/`;
        return assertWebUrl(new URL("api/docs", base).href).href;
    }
    if (!instance.clientUrl) {
        throw new Error(
            `Instance ${instanceName} has no web client URL. Use --docs to open the API documentation instead.`,
        );
    }
    return assertWebUrl(instance.clientUrl).href;
}

export async function runOpenCommand(
    config: CliConfig,
    parsed: ParsedArgs,
    context: CommandContext,
    dependencies: OpenDependencies = defaultDependencies,
): Promise<number> {
    const [instanceName, instance] = resolveInstance(config, parsed);
    const url = resolveOpenTarget(
        instanceName,
        instance,
        parsed.flags.docs === true,
    );

    // Scripts, pipes and CI get the URL on stdout and nothing else.
    if (parsed.flags.print === true || context.interactive !== true) {
        context.stdout.write(`${url}\n`);
        return 0;
    }

    const launcher = await chooseLauncher(url, {
        platform: dependencies.platform,
        env: context.env,
        which: pathLookup(context.env, dependencies.platform),
    });
    if (!launcher || !(await dependencies.launch(launcher))) {
        context.stdout.write(`No browser is available here. Open: ${url}\n`);
        return 0;
    }

    context.stdout.write(`Opening ${url}\n`);
    return 0;
}
