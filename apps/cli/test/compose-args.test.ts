import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
    assertKnownService,
    assertServiceName,
    assertSince,
    buildComposeBaseArgs,
    buildComposeListServicesArgs,
    buildComposeLogsArgs,
    buildComposePsArgs,
    buildComposeRestartArgs,
    parseServiceList,
} from "../src/services/compose-args.js";
import type { InstanceConfig } from "../src/types.js";

describe("compose argument construction", () => {
    it("builds the shared base arguments in a stable order", () => {
        const instance: InstanceConfig = {
            target: "compose",
            url: "http://localhost:3000",
            envFile: ".env",
            composeProfiles: ["client"],
            projectName: "eudiplo-local",
        };
        expect(
            buildComposeBaseArgs(instance, "/srv/eudiplo", [
                "docker-compose.yml",
                "docker-compose.override.yml",
            ]),
        ).toEqual([
            "compose",
            "--env-file",
            resolve("/srv/eudiplo", ".env"),
            "-f",
            resolve("/srv/eudiplo", "docker-compose.yml"),
            "-f",
            resolve("/srv/eudiplo", "docker-compose.override.yml"),
            "--profile",
            "client",
            "--project-name",
            "eudiplo-local",
        ]);
    });

    it("builds ps and service listing arguments", () => {
        expect(buildComposePsArgs()).toEqual(["ps"]);
        expect(buildComposeListServicesArgs()).toEqual([
            "config",
            "--services",
        ]);
    });

    it("does not follow logs unless asked", () => {
        expect(buildComposeLogsArgs(undefined)).toEqual(["logs"]);
    });

    it("maps every log option and places the service last", () => {
        expect(
            buildComposeLogsArgs("eudiplo", {
                follow: true,
                tail: 100,
                since: "10m",
            }),
        ).toEqual([
            "logs",
            "--follow",
            "--tail",
            "100",
            "--since",
            "10m",
            "eudiplo",
        ]);
    });

    it("restarts one service or the whole project", () => {
        expect(buildComposeRestartArgs("eudiplo-client")).toEqual([
            "restart",
            "eudiplo-client",
        ]);
        expect(buildComposeRestartArgs(undefined)).toEqual(["restart"]);
    });
});

describe("compose argument validation", () => {
    it.each(["eudiplo", "eudiplo-client", "db_1", "svc.v2", "2fa"])(
        "accepts service name %s",
        (name) => {
            expect(() => assertServiceName(name)).not.toThrow();
        },
    );

    it.each(["--rm", "-f", "", "a b", "x;rm -rf", "../etc", "svc/other"])(
        "rejects service name %j",
        (name) => {
            expect(() => assertServiceName(name)).toThrow(
                /Invalid service name/,
            );
        },
    );

    it("never places a rejected service into the argv", () => {
        expect(() => buildComposeLogsArgs("--help")).toThrow();
        expect(() => buildComposeRestartArgs("-t")).toThrow();
    });

    it.each([
        "10m",
        "2h30m",
        "1.5h",
        "45s",
        "2026-09-01",
        "2026-09-01T12:00:00Z",
    ])("accepts --since %s", (since) => {
        expect(() => assertSince(since)).not.toThrow();
    });

    it.each(["yesterday", "-10m", "10", "10 m", "2026-13-45", "--follow"])(
        "rejects --since %j",
        (since) => {
            expect(() => assertSince(since)).toThrow(/Invalid --since/);
        },
    );

    it.each([-1, 1.5, Number.NaN])("rejects --tail %s", (tail) => {
        expect(() => buildComposeLogsArgs(undefined, { tail })).toThrow(
            /--tail/,
        );
    });

    it("ignores runtime noise when parsing the service list", () => {
        const stdout = [
            '>>>> Executing external compose provider "/usr/bin/docker-compose". Please see podman-compose(1) for how to disable this message. <<<<',
            "eudiplo-client",
            "",
            "eudiplo",
        ].join("\n");
        expect(parseServiceList(stdout)).toEqual(["eudiplo", "eudiplo-client"]);
    });

    it("lists the real services when one is unknown", () => {
        expect(() =>
            assertKnownService("backend", ["eudiplo", "eudiplo-client"]),
        ).toThrow(
            "Unknown service backend. Services in this project: eudiplo, eudiplo-client.",
        );
    });
});
