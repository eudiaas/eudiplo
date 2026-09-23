import { describe, expect, it } from "vitest";
import { AuthorizationServersService } from "./authorization-servers.service";

/**
 * espuni fork: what the holder presented has to reach the issuer.
 *
 * This authorization server authenticates the holder by asking for a
 * credential and then says nothing about them — `sub` is the *wallet's*
 * `client_id`. The result of the authentication reaches the issuer only as
 * shared state, so anything that wants those attributes has to go and read a
 * session. Carrying them in the token removes that indirection: EUDIPLO
 * already forwards the whole token payload to the attribute provider as
 * `identity.token_claims`.
 *
 * `presentedClaims` is the part with the decisions in it, so it is what is
 * pinned here.
 */
const claimsDe = (svc: AuthorizationServersService, credentials: unknown) =>
    (
        svc as unknown as {
            presentedClaims(c: unknown): Record<string, unknown> | undefined;
        }
    ).presentedClaims(credentials);

describe("AuthorizationServersService — claims presentados en el token", () => {
    const svc = Object.create(
        AuthorizationServersService.prototype,
    ) as AuthorizationServersService;

    it("lleva TODOS los claims divulgados, no una seleccion", () => {
        expect(
            claimsDe(svc, [
                {
                    claims: {
                        given_name: "Lucía",
                        family_name: "Martín Sanz",
                        personal_administrative_number: "52814736C",
                        age_over_18: true,
                    },
                },
            ]),
        ).toEqual({
            given_name: "Lucía",
            family_name: "Martín Sanz",
            personal_administrative_number: "52814736C",
            age_over_18: true,
        });
    });

    /**
     * Que atributos viajan se decide donde toca: en la configuracion de
     * presentacion que el emisor fija en este AS. Recortar aqui solo moveria
     * la decision a un sitio donde nadie la ve.
     */
    it("nada es especifico del PID: lleva lo que se haya presentado", () => {
        expect(
            claimsDe(svc, [
                { claims: { titulo: "Ingeniería", universidad: "UZ" } },
            ]),
        ).toEqual({ titulo: "Ingeniería", universidad: "UZ" });
    });

    it("tambien la forma antigua, con `values`", () => {
        expect(claimsDe(svc, [{ values: [{ given_name: "Lucía" }] }])).toEqual({
            given_name: "Lucía",
        });
    });

    it("varias credenciales presentadas se juntan", () => {
        expect(
            claimsDe(svc, [
                { claims: { given_name: "Lucía" } },
                { claims: { titulo: "Ingeniería" } },
            ]),
        ).toEqual({ given_name: "Lucía", titulo: "Ingeniería" });
    });

    /**
     * Sin presentacion no se inventa un objeto vacio: el campo no viaja. Un
     * `presented_claims: {}` en el token diria "se presento algo y no tenia
     * nada", que es distinto de "no hubo presentacion".
     */
    it("sin presentacion, el campo no existe", () => {
        expect(claimsDe(svc, undefined)).toBeUndefined();
        expect(claimsDe(svc, [])).toBeUndefined();
        expect(claimsDe(svc, [{ claims: {} }])).toBeUndefined();
    });
});
