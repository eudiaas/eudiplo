import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

/**
 * Add the `clientMetadataExtra` column to `presentation_config`.
 *
 * Holds additional members merged into `client_metadata` when the authorization
 * request is built. `client_metadata` is an extensible object in OpenID4VP, but
 * EUDIPLO emits a fixed literal — so a deployment that needs an
 * ecosystem-specific member has no way to add one without patching the request
 * builder. Nullable: a null value means "emit exactly what we emit today".
 */
export class AddClientMetadataExtraToPresentationConfig1792000000000
    implements MigrationInterface
{
    name = "AddClientMetadataExtraToPresentationConfig1792000000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable("presentation_config");
        if (!table) {
            console.log(
                "[Migration] presentation_config table not found — skipping.",
            );
            return;
        }

        if (!table.columns.some((c) => c.name === "clientMetadataExtra")) {
            await queryRunner.addColumn(
                "presentation_config",
                new TableColumn({
                    name: "clientMetadataExtra",
                    type: "json",
                    isNullable: true,
                }),
            );
            console.log(
                "[Migration] Added clientMetadataExtra column to presentation_config.",
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable("presentation_config");
        if (!table) return;

        if (table.columns.some((c) => c.name === "clientMetadataExtra")) {
            await queryRunner.dropColumn(
                "presentation_config",
                "clientMetadataExtra",
            );
        }
    }
}
