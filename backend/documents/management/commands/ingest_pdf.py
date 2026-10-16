from django.core.management.base import BaseCommand, CommandError

from documents import audit
from documents.pdf_only import ingest_pdf_only


class Command(BaseCommand):
    help = (
        "Read one PDF-only document revision (a document with no XML) and store "
        "it like an XML revision, with IDs derived from the PDF."
    )

    def add_arguments(self, parser) -> None:
        parser.add_argument("path", help="Path to the PDF, inside the project folder.")
        parser.add_argument("--doc-id", help="Document ID. Default: from the file name.")
        parser.add_argument(
            "--revision",
            type=int,
            help="Revision number. Default: 0 for a new document, else the next number.",
        )
        parser.add_argument("--revision-date", help="YYYY-MM-DD. Default: the effective date.")
        parser.add_argument("--change-summary", help="What changed in this revision.")
        parser.add_argument(
            "--replace",
            action="store_true",
            help="Replace this document revision if it has already been stored.",
        )

    def handle(self, *args, **options) -> None:
        result = ingest_pdf_only(
            options["path"],
            document_id=options["doc_id"],
            revision=options["revision"],
            revision_date=options["revision_date"],
            change_summary=options["change_summary"],
            replace=options["replace"],
        )
        if not result.success:
            raise CommandError(result.message or "PDF ingestion failed.")
        audit.record(
            "document.ingested",
            document_id=result.document_id,
            revision=result.revision,
            details={"source": "pdf-only", "file": options["path"], "replaced": options["replace"],
                     "sections": result.sections, "paragraphs": result.paragraphs,
                     "idsKept": result.kept_ids, "idsNew": result.new_ids},
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"Ingested {result.document_id} Rev {result.revision}: "
                f"{result.sections} sections, {result.paragraphs} paragraphs "
                f"({result.kept_ids} IDs kept from the previous revision, "
                f"{result.new_ids} new)."
            )
        )
