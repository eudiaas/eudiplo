import { describe, expect, it, vi } from "vitest";
import { Oid4vciService } from "./oid4vci.service";
import {
    Notification,
    Session,
} from "../../../session/entities/session.entity";

/**
 * espuni (PATCHES.md §1.11): el webhook de emisión se manda al ENTREGAR la
 * credencial, no solo cuando el wallet notifica.
 *
 * `wallet-core` 0.30.2 no manda nunca la notificación de OpenID4VCI —no
 * referencia `NotifyIssuer` en toda su superficie—, así que sin esto el RP no
 * se entera de que se emitió una credencial y la sesión caduca como si no
 * hubiera pasado nada.
 */
const SESSION = {
    id: "s-1",
    tenantId: "t-1",
    webhookEndpointId: "wh-1",
} as unknown as Session;

const ENTREGADA: Notification = {
    id: "n-1",
    credentialConfigurationId: "pid-mdoc",
};
const CONFIRMADA: Notification = { ...ENTREGADA, event: "credential_accepted" };

/** El servicio desnudo, con solo los colaboradores que toca este método. */
function build(
    endpoint: unknown = { url: "https://rp.example/hook", auth: null },
) {
    const svc = Object.create(Oid4vciService.prototype) as any;
    const sendWebhookNotification = vi.fn().mockResolvedValue(undefined);
    const logError = vi.fn();
    Object.assign(svc, {
        webhookEndpointRepo: { findOneBy: vi.fn().mockResolvedValue(endpoint) },
        webhookService: { sendWebhookNotification },
        auditLogger: { logError },
    });
    return { svc, sendWebhookNotification, logError };
}

describe("sendIssuanceWebhook", () => {
    it("avisa al entregar, con la notificacion todavia sin event", async () => {
        const { svc, sendWebhookNotification } = build();

        await svc.sendIssuanceWebhook(SESSION, ENTREGADA, {});

        const [webhook, session, notification] =
            sendWebhookNotification.mock.calls[0];
        expect(webhook.url).toBe("https://rp.example/hook");
        expect(session.id).toBe("s-1");
        // La ausencia de `event` ES la señal de «entregada, sin confirmar».
        // Quien lo consuma tiene que distinguirla; tratarla como un fallo es
        // peor que no mandar nada.
        expect(notification.event).toBeUndefined();
        expect(notification.id).toBe("n-1");
    });

    it("vuelve a avisar cuando el wallet confirma, ya con event", async () => {
        const { svc, sendWebhookNotification } = build();

        await svc.sendIssuanceWebhook(SESSION, CONFIRMADA, {});

        expect(sendWebhookNotification.mock.calls[0][2].event).toBe(
            "credential_accepted",
        );
    });

    it("no manda nada si el tenant no tiene webhook", async () => {
        const { svc, sendWebhookNotification } = build();
        await svc.sendIssuanceWebhook(
            { ...SESSION, webhookEndpointId: null } as unknown as Session,
            ENTREGADA,
            {},
        );
        expect(sendWebhookNotification).not.toHaveBeenCalled();
    });

    it("no manda nada si el endpoint ya no existe", async () => {
        const { svc, sendWebhookNotification } = build(null);
        await svc.sendIssuanceWebhook(SESSION, ENTREGADA, {});
        expect(sendWebhookNotification).not.toHaveBeenCalled();
    });

    // Lo importante: en la entrega la credencial YA se emitió. Tumbar la
    // petición por un webhook caído le quitaría al wallet una credencial que
    // el emisor ya gastó, y con `once_only` esa no vuelve.
    it("un webhook caido no tumba la emision: se registra y sigue", async () => {
        const { svc, sendWebhookNotification, logError } = build();
        sendWebhookNotification.mockRejectedValue(new Error("ECONNREFUSED"));

        await expect(
            svc.sendIssuanceWebhook(SESSION, ENTREGADA, {}),
        ).resolves.toBeUndefined();
        expect(logError).toHaveBeenCalled();
    });
});
