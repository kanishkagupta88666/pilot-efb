from django.contrib import admin
from django.urls import path

from documents.views import (
    document_library,
    health,
    navigation,
    node_changes,
    pdf_file,
    pdf_outline,
    resolve_node,
    revision_changes,
    topic_content,
)


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health, name="health"),
    path("api/documents/", document_library, name="document-library"),
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
