# -*- coding: utf-8 -*-
# Copyright 2021 Google Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License")
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import threading
from dataclasses import dataclass, field
from typing import Any, Type

import settings
from api import (
  accounts_api,
  attachments_api,
  blink_components_api,
  channels_api,
  comments_api,
  component_users,
  components_users,
  cues_api,
  external_reviews_api,
  feature_latency_api,
  feature_links_api,
  features_api,
  intents_api,
  login_api,
  logout_api,
  metricsdata,
  origin_trials_api,
  permissions_api,
  processes_api,
  review_latency_api,
  reviews_api,
  settings_api,
  spec_mentors_api,
  stages_api,
  stars_api,
  token_refresh_api,
  webdx_feature_api,
)
from framework import basehandlers, csp, sendemail
from internals import (
  data_backup,
  detect_intent,
  feature_links,
  fetchmetrics,
  inactive_users,
  maintenance_scripts,
  notifier,
  reminders,
  search_fulltext,
)
from pages import featurelist, guide, intentpreview, metrics, ot_requests, users

# Patch treading library to work-around bug with Google Cloud Logging.
original_delete = threading.Thread._delete  # type: ignore
def safe_delete(self):
  try:
    original_delete(self)
  except KeyError:
    pass
threading.Thread._delete = safe_delete  # type: ignore


# Sets up Cloud Logging client library.
if not settings.UNIT_TEST_MODE and not settings.DEV_MODE:
  import google.cloud.logging
  client = google.cloud.logging.Client()
  client.setup_logging()


# Note: In the URLs below, parameters like <int:feature_id> are
# required for the URL to match the route, but we still accecpt
# those parameters as keywords in those handlers where the same
# handler might be used for multiple routes that have the field
# or not.

@dataclass
class Route:
  path: str
  handler_class: Type[basehandlers.BaseHandler] = basehandlers.SPAHandler
  defaults: dict[str, Any] = field(default_factory=dict)


metrics_chart_routes: list[Route] = [
    Route('/data/timeline/cssanimated', metricsdata.AnimatedTimelineHandler),
    Route('/data/timeline/csspopularity', metricsdata.PopularityTimelineHandler),
    Route('/data/timeline/featurepopularity',
        metricsdata.FeatureObserverTimelineHandler),
    Route('/data/timeline/webfeaturepopularity',
        metricsdata.WebFeatureTimelineHandler),
    Route('/data/csspopularity', metricsdata.CSSPopularityHandler),
    Route('/data/cssanimated', metricsdata.CSSAnimatedHandler),
    Route('/data/featurepopularity',
        metricsdata.FeatureObserverPopularityHandler),
    Route('/data/webfeaturepopularity',
        metricsdata.WebFeaturePopularityHandler),
    Route('/data/blink/<string:prop_type>', metricsdata.FeatureBucketsHandler),
]

# TODO(jrobbins): Advance this to v1 once we have it fleshed out
API_BASE = '/api/v0'
api_routes: list[Route] = [
    Route(f'{API_BASE}/features', features_api.FeaturesAPI),
    Route(f'{API_BASE}/features/<int:feature_id>', features_api.FeaturesAPI),
    Route(f'{API_BASE}/features/create', features_api.FeaturesAPI),
    Route(f'{API_BASE}/feature_links', feature_links_api.FeatureLinksAPI),
    Route(f'{API_BASE}/feature_links_summary', feature_links_api.FeatureLinksSummaryAPI),
    Route(f'{API_BASE}/feature_links_samples', feature_links_api.FeatureLinksSamplesAPI),
    Route(f'{API_BASE}/features/<int:feature_id>/votes',
        reviews_api.VotesAPI),
    Route(f'{API_BASE}/features/<int:feature_id>/votes/<int:gate_id>',
        reviews_api.VotesAPI),
    Route(f'{API_BASE}/features/<int:feature_id>/gates',
        reviews_api.GatesAPI),
    Route(f'{API_BASE}/features/<int:feature_id>/gates/<int:gate_id>',
        reviews_api.GatesAPI),
    Route(f'{API_BASE}/gates/pending',
        reviews_api.PendingGatesAPI),
    Route(f'{API_BASE}/features/<int:feature_id>/approvals/comments',
        comments_api.CommentsAPI),
    Route(f'{API_BASE}/features/<int:feature_id>/approvals/<int:gate_id>/comments',
        comments_api.CommentsAPI),
    Route(f'{API_BASE}/features/<int:feature_id>/attachments',
        attachments_api.AttachmentsAPI),
    Route(f'{API_BASE}/features/<int:feature_id>/process',
        processes_api.ProcessesAPI),
    Route(f'{API_BASE}/features/<int:feature_id>/progress',
        processes_api.ProgressAPI),
    Route(f'{API_BASE}/features/<int:feature_id>/stages',
            stages_api.StagesAPI),
    Route(f'{API_BASE}/features/<int:feature_id>/stages/<int:stage_id>',
            stages_api.StagesAPI),
    Route(
        f'{API_BASE}/features/<int:feature_id>/stages/<int:stage_id>/addXfnGates',
        reviews_api.XfnGatesAPI),
    Route(f'{API_BASE}/features/<int:feature_id>/<int:stage_id>/intent',
          intents_api.IntentsAPI),
    Route(f'{API_BASE}/features/<int:feature_id>/<int:stage_id>/<int:gate_id>/intent',
          intents_api.IntentsAPI),

    Route(f'{API_BASE}/blinkcomponents',
        blink_components_api.BlinkComponentsAPI),
    Route(f'{API_BASE}/componentsusers',
        components_users.ComponentsUsersAPI),
    Route(f'{API_BASE}/components/<int:component_id>/users/<int:user_id>',
        component_users.ComponentUsersAPI),

    Route(f'{API_BASE}/external_reviews/<string:review_group>', external_reviews_api.ExternalReviewsAPI),
    Route(f'{API_BASE}/spec_mentors', spec_mentors_api.SpecMentorsAPI),
    Route(f'{API_BASE}/feature-latency', feature_latency_api.FeatureLatencyAPI),
    Route(f'{API_BASE}/review-latency', review_latency_api.ReviewLatencyAPI),

    Route(f'{API_BASE}/login', login_api.LoginAPI),
    Route(f'{API_BASE}/logout', logout_api.LogoutAPI),
    Route(f'{API_BASE}/currentuser/permissions', permissions_api.PermissionsAPI),
    Route(f'{API_BASE}/currentuser/settings', settings_api.SettingsAPI),
    Route(f'{API_BASE}/currentuser/stars', stars_api.StarsAPI),
    Route(f'{API_BASE}/currentuser/cues', cues_api.CuesAPI),
    Route(f'{API_BASE}/currentuser/token', token_refresh_api.TokenRefreshAPI),
    # (f'{API_BASE}/currentuser/autosaves', TODO),

    # Admin operations for user accounts
    Route(f'{API_BASE}/accounts', accounts_api.AccountsAPI),
    Route(f'{API_BASE}/accounts/<int:account_id>', accounts_api.AccountsAPI),

    Route(f'{API_BASE}/channels', channels_api.ChannelsAPI),  # omaha data
    # (f'{API_BASE}/schedule', TODO),  # chromiumdash data
    # (f'{API_BASE}/metrics/<str:kind>', TODO),  # uma-export data
    # (f'{API_BASE}/metrics/<str:kind>/<int:bucket_id>', TODO),
    Route(f'{API_BASE}/origintrials', origin_trials_api.OriginTrialsAPI),
    Route(f'{API_BASE}/origintrials/<int:feature_id>/<int:stage_id>/create',
          origin_trials_api.OriginTrialsAPI),
    Route(f'{API_BASE}/origintrials/<int:feature_id>/<int:extension_stage_id>/extend',
          origin_trials_api.OriginTrialsAPI),

    # This is for the menu of web feature IDs.
    Route(f'{API_BASE}/web_feature_ids', webdx_feature_api.WebFeatureIDsAPI),
    # This is for the menu of webdx use counters.
    Route(f'{API_BASE}/webdxfeatures', webdx_feature_api.WebdxFeatureAPI),
]

# The Routes below that have no handler specified use SPAHandler.
# The guide.* handlers each call get_spa_template_data().
spa_page_routes = [
  Route('/'),
  Route('/roadmap'),
  # TODO(jrobbins): remove '/myfeatures' after a while.
  Route('/myfeatures', defaults={'require_signin': True}),
  Route('/myfeatures/review', defaults={'require_signin': True}),
  Route('/myfeatures/starred', defaults={'require_signin': True}),
  Route('/myfeatures/editable', defaults={'require_signin': True}),
  Route('/features'),
  Route('/newfeatures'),
  Route('/feature/<int:feature_id>'),
  Route('/feature/<int:feature_id>/activity'),
  Route('/guide/new', guide.FeatureCreateHandler,
      defaults={'require_create_feature': True}),
  Route('/guide/enterprise/new', guide.EnterpriseFeatureCreateHandler,
      defaults={'require_signin': True, 'require_create_feature': True, 'is_enterprise_page': True}),
  Route('/guide/stage/<int:feature_id>/<int:intent_stage>/<int:stage_id>',
      defaults={'require_edit_feature': True}),
  Route('/guide/stage/<int:feature_id>/<int:stage_id>',
      defaults={'require_edit_feature': True}),
  Route('/guide/edit/<int:feature_id>/<int:stage_id>',
      defaults={'require_edit_feature': True}),
  Route('/guide/editall/<int:feature_id>',
      defaults={'require_edit_feature': True}),
  Route('/guide/verify_accuracy/<int:feature_id>',
      defaults={'require_edit_feature': True}),
  Route('/guide/stage/<int:feature_id>/metadata',
      defaults={'require_edit_feature': True}),
  Route('/feature/<int:feature_id>/gate/<int:gate_id>/intent',
        defaults={'require_edit_feature': True}),
  Route('/ot_creation_request/<int:feature_id>/<int:stage_id>',
        defaults={'require_signin': True}),
  Route('/ot_extension_request/<int:feature_id>/<int:stage_id>',
        defaults={'require_signin': True}),
  Route('/metrics'),
  Route('/metrics/css'),
  Route('/metrics/css/popularity'),
  Route('/metrics/css/animated'),
  Route('/metrics/css/timeline/popularity'),
  Route('/metrics/css/timeline/popularity/<int:bucket_id>'),
  Route('/metrics/css/timeline/animated'),
  Route('/metrics/css/timeline/animated/<int:bucket_id>'),
  Route('/metrics/feature/popularity'),
  Route('/metrics/feature/timeline/popularity'),
  Route('/metrics/feature/timeline/popularity/<int:bucket_id>'),
  Route('/metrics/webfeature/popularity'),
  Route('/metrics/webfeature/timeline/popularity'),
  Route('/metrics/webfeature/timeline/popularity/<int:bucket_id>'),
  Route('/reports/external_reviews'),
  Route('/reports/external_reviews/<reviewer>'),
  Route('/reports/spec_mentors'),
  Route('/reports/feature-latency'),
  Route('/reports/review-latency'),
  Route('/settings', defaults={'require_signin': True}),
  Route('/enterprise'),
  Route(
    '/enterprise/releasenotes',
    defaults={'require_signin': True, 'is_enterprise_page': True}),
  # Admin pages
  Route('/admin/blink', defaults={'require_admin_site': True, 'require_signin': True}),
  Route('/admin/feature_links', defaults={'require_admin_site': True, 'require_signin': True}),
  Route('/admin/slo_report', reminders.SLOReportHandler),
]

mpa_page_routes: list[Route] = [
    Route('/admin/users/new', users.UserListHandler),
    Route('/admin/ot_requests', ot_requests.OriginTrialsRequests),

    Route('/admin/features/launch/<int:feature_id>',
        intentpreview.IntentEmailPreviewHandler),
    Route('/admin/features/launch/<int:feature_id>/<int:intent_stage>',
        intentpreview.IntentEmailPreviewHandler),
    Route('/admin/features/launch/<int:feature_id>/<int:intent_stage>/<int:gate_id>',
        intentpreview.IntentEmailPreviewHandler),

    # Note: The only requests being made now hit /features.json and
    # /features_v2.json, but both of those cause version == 2.
    # There was logic to accept another version value, but it it was not used.
    Route(r'/features.json', featurelist.FeaturesJsonHandler),
    Route(r'/features_v2.json', featurelist.FeaturesJsonHandler),

    Route('/oldfeatures', featurelist.FeatureListHandler),
    Route('/features/<int:feature_id>', featurelist.FeatureListHandler),
    Route('/features.xml', basehandlers.ConstHandler,
        defaults={'template_path': 'farewell-rss.xml'}),
    Route('/samples', basehandlers.ConstHandler,
        defaults={'template_path': 'farewell-samples.html'}),

    Route('/omaha_data', metrics.OmahaDataHandler),
    Route('/feature/<int:feature_id>/attachment/<int:attachment_id>',
          attachments_api.AttachmentServing),
    Route('/feature/<int:feature_id>/attachment/<int:attachment_id>/thumbnail',
          attachments_api.AttachmentServing,
          defaults={'thumbnail': True}),
]

internals_routes: list[Route] = [
  Route('/cron/metrics', fetchmetrics.YesterdayHandler),
  Route('/cron/histograms', fetchmetrics.HistogramsHandler),
  Route('/cron/update_blink_components', fetchmetrics.BlinkComponentHandler),
  Route('/cron/export_backup', data_backup.BackupExportHandler),
  Route('/cron/send_accuracy_notifications', reminders.FeatureAccuracyHandler),
  Route('/cron/send_prepublication', reminders.PrepublicationHandler),
  Route('/cron/send_overdue_reviews', reminders.SLOOverdueHandler),
  Route('/cron/warn_inactive_users', notifier.NotifyInactiveUsersHandler),
  Route('/cron/remove_inactive_users',
      inactive_users.RemoveInactiveUsersHandler),
  Route('/cron/reindex_all', search_fulltext.ReindexAllFeatures),
  Route('/cron/update_all_feature_links', feature_links.UpdateAllFeatureLinksHandlers),
  Route('/cron/associate_origin_trials', maintenance_scripts.AssociateOTs),
  Route('/cron/send-ot-process-reminders',
        reminders.SendOTReminderEmailsHandler),
  Route('/cron/create_origin_trials', maintenance_scripts.CreateOriginTrials),
  Route('/cron/activate_origin_trials',
        maintenance_scripts.ActivateOriginTrials),
  Route('/cron/fetch_webdx_feature_ids', maintenance_scripts.FetchWebdxFeatureId),
  Route('/cron/generate_review_activities',
        maintenance_scripts.GenerateReviewActivityFile),

  Route('/admin/find_stop_words', search_fulltext.FindStopWords),

  Route('/tasks/email-subscribers', notifier.FeatureChangeHandler),
  Route('/tasks/detect-intent', detect_intent.IntentEmailHandler),
  Route('/tasks/email-reviewers', notifier.FeatureReviewHandler),
  Route('/tasks/email-assigned', notifier.ReviewAssignmentHandler),
  Route('/tasks/email-comments', notifier.FeatureCommentHandler),
  Route('/tasks/update-feature-links', feature_links.FeatureLinksUpdateHandler),
  Route('/tasks/email-ot-activated', notifier.OTActivatedHandler),
  Route('/tasks/email-ot-creation-processed',
        notifier.OTCreationProcessedHandler),
  Route('/tasks/email-ot-creation-request-failed',
        notifier.OTCreationRequestFailedHandler),
  Route('/tasks/email-ot-activation-failed',
        notifier.OTActivationFailedHandler),
  Route('/tasks/email-ot-creation-request', notifier.OTCreationRequestHandler),
  Route('/tasks/email-ot-creation-approved',
        notifier.OTCreationApprovedHandler),
  Route('/tasks/email-ot-extended', notifier.OTExtendedHandler),
  Route('/tasks/email-ot-extension-approved',
        notifier.OTExtensionApprovedHandler),
  Route('/tasks/email-intent-to-blink-dev', notifier.IntentToBlinkDevHandler),

  # OT process reminder emails
  Route('/tasks/email-ot-first-branch', notifier.OTFirstBranchReminderHandler),
  Route('/tasks/email-ot-last-branch', notifier.OTLastBranchReminderHandler),
  Route('/tasks/email-ot-ending-next-release',
        notifier.OTEndingNextReleaseReminderHandler),
  Route('/tasks/email-ot-ending-this-release',
        notifier.OTEndingThisReleaseReminderHandler),
  Route('/tasks/email-ot-beta-availability',
        notifier.OTBetaAvailabilityReminderHandler),
  Route('/tasks/email-ot-automated-process',
        notifier.OTAutomatedProcessEmailHandler),

  # Maintenance scripts.
  Route('/scripts/evaluate_gate_status',
        maintenance_scripts.EvaluateGateStatus),
  Route('/scripts/write_missing_gates',
        maintenance_scripts.WriteMissingGates),
  Route('/scripts/backfill_responded_on',
        maintenance_scripts.BackfillRespondedOn),
  Route('/scripts/backfill_stage_created',
        maintenance_scripts.BackfillStageCreated),
  Route('/scripts/backfill_feature_links',
        maintenance_scripts.BackfillFeatureLinks),
  Route('/scripts/backfill_enterprise_impact',
        maintenance_scripts.BackfillFeatureEnterpriseImpact),
  Route('/scripts/delete_empty_extension_stages',
        maintenance_scripts.DeleteEmptyExtensionStages),
  Route('/scripts/backfill_shipping_year',
        maintenance_scripts.BackfillShippingYear),
  Route('/scripts/backfill_gate_dates',
        maintenance_scripts.BackfillGateDates),
  Route('/scripts/send_ot_creation_email/<int:stage_id>',
        maintenance_scripts.SendManualOTCreatedEmail),
  Route('/scripts/send_ot_activation_email/<int:stage_id>',
        maintenance_scripts.SendManualOTActivatedEmail),
]

dev_routes: list[Route] = []
if settings.DEV_MODE:
  dev_routes = [
    Route('/dev/mock_login', login_api.MockLogin),
  ]
# All requests to the app-py3 GAE service are handled by this Flask app.
app = basehandlers.FlaskApplication(
    __name__,
    (metrics_chart_routes + api_routes + mpa_page_routes + spa_page_routes +
     internals_routes + dev_routes))

# TODO(jrobbins): Make the CSP handler be a class like our others.
app.add_url_rule(
    '/csp', view_func=csp.report_handler,
     methods=['POST'])

sendemail.add_routes(app)

if __name__ == '__main__':
    # This is used when running locally only. When deploying to Google App
    # Engine, a webserver process such as Gunicorn will serve the app. This
    # can be configured by adding an `entrypoint` to app.yaml.
    app.run(host='127.0.0.1', port=7777)
