from django.contrib import admin
from django.urls import path

from documents import authoring_views
from documents.views import (
    document_library,
    health,
    navigation,
    node_changes,
    pdf_file,
    pdf_outline,
    resolve_node,
    revision_changes,
    search_documents,
    search_index,
    topic_content,
)


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health, name="health"),
    path("api/documents/", document_library, name="document-library"),
    path("api/search/", search_documents, name="search"),
    path("api/documents/<str:doc_id>/draft/", authoring_views.draft, name="draft"),
    path(
        "api/documents/<str:doc_id>/draft/publish/",
        authoring_views.publish_draft,
        name="draft-publish",
    ),
    path(
        "api/documents/<str:doc_id>/draft/topics/",
        authoring_views.draft_topics,
        name="draft-topics",
    ),
    path(
        "api/documents/<str:doc_id>/draft/topics/<str:topic_id>/",
        authoring_views.draft_topic,
        name="draft-topic",
    ),
    path(
        "api/documents/<str:doc_id>/draft/topics/<str:topic_id>/blocks/",
        authoring_views.draft_blocks,
        name="draft-blocks",
    ),
    path(
        "api/documents/<str:doc_id>/draft/topics/<str:topic_id>/blocks/<str:block_id>/",
        authoring_views.draft_block,
        name="draft-block",
    ),
    path("api/search/index/", search_index, name="search-index"),
    path(
        "api/documents/<str:doc_id>/revisions/<str:revision>/navigation/",
        navigation,
        name="document-navigation",
    ),
    path(
        "api/documents/<str:doc_id>/revisions/<str:revision>/topics/<str:topic_id>/",
        topic_content,
        name="document-topic",
    ),
    path(
        "api/documents/<str:doc_id>/resolve-node/",
        resolve_node,
        name="document-resolve-node",
    ),
    path(
        "api/documents/<str:doc_id>/changes/",
        revision_changes,
        name="document-changes",
    ),
    path(
        "api/documents/<str:doc_id>/changes/nodes/<str:node_id>/",
        node_changes,
        name="document-node-changes",
    ),
    path(
        "api/documents/<str:doc_id>/revisions/<str:revision>/pdf/",
        pdf_file,
        name="document-pdf-file",
    ),
    path(
        "api/documents/<str:doc_id>/revisions/<str:revision>/pdf/outline/",
        pdf_outline,
        name="document-pdf-outline",
    ),
]
