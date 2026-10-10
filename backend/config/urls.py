from django.contrib import admin
from django.urls import path

from documents.views import (
    document_library,
    health,
    navigation,
    resolve_node,
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
]
