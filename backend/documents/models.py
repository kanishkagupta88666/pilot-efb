from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone


class Document(models.Model):
    id = models.CharField(max_length=128, primary_key=True)
    title = models.CharField(max_length=500)
    doc_type = models.CharField(max_length=64)
    namespace = models.CharField(max_length=255)

    def __str__(self) -> str:
        return self.id


class DocumentVersion(models.Model):
    document = models.ForeignKey(
        Document,
        on_delete=models.CASCADE,
        related_name="versions",
    )
    revision = models.PositiveIntegerField()
    revision_date = models.DateField()
    effective_date = models.DateField()
    metadata = models.JSONField()
    source_filename = models.CharField(max_length=255)
    ingested_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("document", "revision"),
                name="unique_document_revision",
            )
        ]
        ordering = ("document_id", "revision")

    def __str__(self) -> str:
        return f"{self.document_id} Rev {self.revision}"


class DocumentNode(models.Model):
    class NodeType(models.TextChoices):
        CHAPTER = "chapter", "Chapter"
        SECTION = "section", "Section"
        TOPIC = "topic", "Topic"

    version = models.ForeignKey(
        DocumentVersion,
        on_delete=models.CASCADE,
        related_name="nodes",
    )
    node_id = models.CharField(max_length=128)
    node_type = models.CharField(max_length=16, choices=NodeType.choices)
    number = models.CharField(max_length=64)
    title = models.CharField(max_length=500)
    parent = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="children",
    )
    sequence = models.PositiveIntegerField()
    position = models.PositiveIntegerField()
    content_blocks = models.JSONField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("version", "node_id"),
                name="unique_version_node_id",
            ),
            models.UniqueConstraint(
                fields=("version", "position"),
                name="unique_version_position",
            ),
            models.UniqueConstraint(
                fields=("version", "parent", "sequence"),
                name="unique_version_parent_sequence",
            ),
            models.UniqueConstraint(
                fields=("version", "sequence"),
                condition=models.Q(parent__isnull=True),
                name="unique_version_root_sequence",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(node_type="chapter", parent__isnull=True)
                    | models.Q(node_type="section", parent__isnull=False)
                    | models.Q(node_type="topic", parent__isnull=False)
                ),
                name="documentnode_valid_parent_reference",
            ),
        ]
        indexes = [
            models.Index(
                fields=("version", "parent", "sequence"),
                name="node_parent_sequence_idx",
            ),
            models.Index(
                fields=("version", "position"),
                name="node_position_idx",
            ),
        ]
        ordering = ("version_id", "position")

    def clean(self) -> None:
        super().clean()

        if self.node_type == self.NodeType.CHAPTER:
            if self.parent_id is not None:
                raise ValidationError({"parent": "Chapters cannot have a parent."})
        else:
            if self.parent_id is None:
                raise ValidationError(
                    {"parent": "Sections and topics must have a parent."}
                )
            if self.parent_id == self.pk:
                raise ValidationError({"parent": "A node cannot be its own parent."})
            if self.parent.version_id != self.version_id:
                raise ValidationError(
                    {"parent": "Parent node must belong to the same document version."}
                )

            if self.node_type == self.NodeType.SECTION:
                if self.parent.node_type != self.NodeType.CHAPTER:
                    raise ValidationError(
                        {"parent": "Sections must have a chapter parent."}
                    )
            elif self.node_type == self.NodeType.TOPIC:
                if self.parent.node_type != self.NodeType.SECTION:
                    raise ValidationError(
                        {"parent": "Topics must have a section parent."}
                    )

        if self.parent_id is not None and self.parent_id == self.pk:
            raise ValidationError({"parent": "A node cannot be its own parent."})

        seen: set[int] = set()
        cursor = self.parent
        while cursor is not None:
            if cursor.pk is None:
                break
            if cursor.pk in seen:
                raise ValidationError({"parent": "Parent relationship contains a cycle."})
            seen.add(cursor.pk)
            if cursor.pk == self.pk:
                raise ValidationError({"parent": "Parent relationship contains a cycle."})
            cursor = cursor.parent

        if self.node_type == self.NodeType.SECTION and self.parent_id is not None:
            if self.parent.node_type != self.NodeType.CHAPTER:
                raise ValidationError({"parent": "Sections must be attached to chapters."})
        if self.node_type == self.NodeType.TOPIC and self.parent_id is not None:
            if self.parent.node_type != self.NodeType.SECTION:
                raise ValidationError({"parent": "Topics must be attached to sections."})

    def __str__(self) -> str:
        return f"{self.node_type}:{self.node_id}"


class ContentAnchor(models.Model):
    """One permanent block or checklist check ID and the topic that holds it."""

    class AnchorType(models.TextChoices):
        PARA = "para", "Para"
        NOTE = "note", "Note"
        CAUTION = "caution", "Caution"
        WARNING = "warning", "Warning"
        LIST = "list", "List"
        TABLE = "table", "Table"
        CHECKLIST = "checklist", "Checklist"
        CHECK = "check", "Check"

    version = models.ForeignKey(
        DocumentVersion,
        on_delete=models.CASCADE,
        related_name="anchors",
    )
    topic = models.ForeignKey(
        DocumentNode,
        on_delete=models.CASCADE,
        related_name="anchors",
    )
    anchor_id = models.CharField(max_length=128)
    anchor_type = models.CharField(max_length=16, choices=AnchorType.choices)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("version", "anchor_id"),
                name="unique_version_anchor_id",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.anchor_type}:{self.anchor_id}"
