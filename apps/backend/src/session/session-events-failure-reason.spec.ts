import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionStatus } from "./domain/session-state.js";
import { SessionEventsService } from "./session-events.service.js";

/**
 * espuni fork (PATCHES.md §1.7): the `failed` SSE event says why —
 * `error` (the session's `failureCode`) and `message` (its `errorReason`) —
 * whether the client was connected when it failed or (re)connects after.
 */
describe("SessionEventsService — failure reason on SSE (fork §1.7)", () => {
    const updatedAt = new Date("2026-10-01T10:00:00.000Z");
    let getForTenant: ReturnType<typeof vi.fn>;
    let service: SessionEventsService;

    function subscribe() {
        const messages: Record<string, unknown>[] = [];
        let completed = false;
        service.getSessionEvents("tenant-1", "session-1").subscribe({
            next: (message) => messages.push(JSON.parse(message.data)),
            complete: () => {
                completed = true;
            },
        });
        return { messages, isCompleted: () => completed };
    }

    beforeEach(() => {
        vi.useFakeTimers();
        getForTenant = vi.fn();
        service = new SessionEventsService({ getForTenant } as never);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("carries error and message when connecting to a failed session", async () => {
        getForTenant.mockResolvedValue({
            id: "session-1",
            status: SessionStatus.Failed,
            updatedAt,
            failureCode: "trust_chain_not_trusted",
            errorReason: "The credential issuer is not in the trusted list",
        });

        const stream = subscribe();
        await vi.advanceTimersByTimeAsync(0);

        expect(stream.messages).toEqual([
            {
                id: "session-1",
                status: "failed",
                updatedAt: updatedAt.toISOString(),
                error: "trust_chain_not_trusted",
                message: "The credential issuer is not in the trusted list",
            },
        ]);
        expect(stream.isCompleted()).toBe(true);
    });

    it("reads the reason for a live failed event", async () => {
        getForTenant.mockResolvedValue({
            id: "session-1",
            status: SessionStatus.Active,
            updatedAt,
        });
        const stream = subscribe();
        await vi.advanceTimersByTimeAsync(0);

        getForTenant.mockResolvedValue({
            id: "session-1",
            status: SessionStatus.Failed,
            updatedAt,
            failureCode: "access_denied",
            errorReason: "Wallet error: access_denied",
        });
        service.handleSessionStatusChanged({
            sessionId: "session-1",
            status: SessionStatus.Failed,
            updatedAt,
        });
        await vi.advanceTimersByTimeAsync(0);

        expect(stream.messages.at(-1)).toMatchObject({
            status: "failed",
            error: "access_denied",
            message: "Wallet error: access_denied",
        });
        expect(stream.isCompleted()).toBe(true);
    });

    it("still delivers the failed status when the reason cannot be read", async () => {
        getForTenant.mockResolvedValueOnce({
            id: "session-1",
            status: SessionStatus.Active,
            updatedAt,
        });
        const stream = subscribe();
        await vi.advanceTimersByTimeAsync(0);

        getForTenant.mockRejectedValue(new Error("database down"));
        service.handleSessionStatusChanged({
            sessionId: "session-1",
            status: SessionStatus.Failed,
            updatedAt,
        });
        await vi.advanceTimersByTimeAsync(0);

        expect(stream.messages.at(-1)).toEqual({
            id: "session-1",
            status: "failed",
            updatedAt: updatedAt.toISOString(),
        });
        expect(stream.isCompleted()).toBe(true);
    });

    it("adds nothing to a completed session", async () => {
        getForTenant.mockResolvedValue({
            id: "session-1",
            status: SessionStatus.Completed,
            updatedAt,
            failureCode: "stale",
        });
        const stream = subscribe();
        await vi.advanceTimersByTimeAsync(0);

        expect(stream.messages).toEqual([
            {
                id: "session-1",
                status: "completed",
                updatedAt: updatedAt.toISOString(),
            },
        ]);
    });
});
