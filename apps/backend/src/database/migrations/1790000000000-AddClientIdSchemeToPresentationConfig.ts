import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

/**
 * Add the `clientIdScheme` column to `presentation_config`.
 *
 * Selects the OID4VP client identifier scheme used to build the authorization
 * request: `x509_hash` (default, signed JAR + encrypted response) or
 * `redirect_uri` (unsigned request-by-value + unencrypted `direct_post`, used
 * by the AV QR/deeplink fallback). Nullable — a null value means `x509_hash`.
 */
export class AddClientIdSchemeToPresentationConfig1790000000000
    implements MigrationInterface
{
    name = "AddClientIdSchemeToPresentationConfig1790000000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable("presentation_config");
        if (!table) {
            console.log(
                "[Migration] presentation_config table not found — skipping.",
            );
            return;
        }

        if (!table.columns.some((c) => c.name === "clientIdScheme")) {
            await queryRunner.addColumn(
                "presentation_config",
                new TableColumn({
                    name: "clientIdScheme",
                    type: "varchar",
                    isNullable: true,
                }),
            );
            console.log(
                "[Migration] Added clientIdScheme column to presentation_config.",
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable("presentation_config");
        if (!table) return;

        if (table.columns.some((c) => c.name === "clientIdScheme")) {
            await queryRunner.dropColumn(
                "presentation_config",
                "clientIdScheme",
            );
        }
    }
}
