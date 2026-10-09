from django.core.management.base import BaseCommand, CommandError

from documents.ingestion import ingest_xml


class Command(BaseCommand):
    help = "Validate and ingest one XML manual revision into the database."

    def add_arguments(self, parser) -> None:
        parser.add_argument("path", help="Path to the XML manual.")
        parser.add_argument(
            "--replace",
            action="store_true",
            help="Replace this document revision if it has already been ingested.",
        )

    def handle(self, *args, **options) -> None:
        result = ingest_xml(options["path"], replace=options["replace"])
        if not result.success:
            self.stderr.write(
                self.style.ERROR(
                    result.message or "XML ingestion failed."
                )
            )
            for issue in result.errors:
                location = ""
                if issue["line"] is not None:
                    location = f"line {issue['line']}"
                    if issue["column"] is not None:
                        location += f", column {issue['column']}"
                    location += ": "
                self.stderr.write(f"{location}{issue['message']}")
            for issue in result.unresolved_xrefs:
                self.stderr.write(f"Unresolved cross-reference: {issue['message']}")
            raise CommandError(result.message or "XML ingestion failed.")

        self.stdout.write(
            self.style.SUCCESS(
                f"Ingested {result.document_id} Rev {result.revision}: "
                f"{result.chapters_written} chapters, "
                f"{result.sections_written} sections, "
                f"{result.topics_written} topics "
                f"({result.total_nodes_written} nodes)."
            )
        )
        for block_type, count in sorted(result.skipped_block_counts.items()):
            self.stdout.write(f"Skipped {count} {block_type} block(s).")
        for issue in result.unresolved_xrefs:
            self.stderr.write(f"Unresolved cross-reference: {issue['message']}")
