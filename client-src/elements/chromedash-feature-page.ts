import {LitElement, TemplateResult, css, html, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {ifDefined} from 'lit/directives/if-defined.js';
import {SHARED_STYLES} from '../css/shared-css.js';
import {
  Feature,
  FeatureLink,
  FeatureNotFoundError,
  User,
  StageDict,
} from '../js-src/cs-client.js';
import './chromedash-feature-detail';
import {DETAILS_STYLES} from './chromedash-feature-detail';
import './chromedash-feature-highlights.js';
import {GateDict} from './chromedash-gate-chip.js';
import {Process, ProgressItem} from './chromedash-gate-column.js';
import {showToastMessage, isVerifiedWithinGracePeriod} from './utils.js';
import {
  STAGE_TYPES_SHIPPING,
  STAGE_TYPES_ORIGIN_TRIAL,
  IMPLEMENTATION_STATUS,
} from './form-field-enums';

const INACTIVE_STATES = ['No longer pursuing', 'Deprecated', 'Removed'];
declare var ga: Function;

@customElement('chromedash-feature-page')
export class ChromedashFeaturePage extends LitElement {
  static get styles() {
    return [
      ...SHARED_STYLES,
      ...DETAILS_STYLES,
      css`
        #feature {
          background: var(--card-background);
          border-radius: var(--default-border-radius);
          border: var(--card-border);
          box-shadow: var(--card-box-shadow);

          box-sizing: border-box;
          word-wrap: break-word;
          margin-bottom: var(--content-padding);
          max-width: var(--max-content-width);
        }
        #feature ul {
          list-style-position: inside;
          list-style: none;
        }
        section {
          margin-bottom: 1em;
        }
        section h3 {
          margin: 24px 0 12px;
        }
        section label {
          font-weight: 500;
          margin-right: 5px;
        }

        sl-skeleton {
          margin-bottom: 1em;
          width: 60%;
        }

        sl-skeleton:nth-of-type(even) {
          width: 50%;
        }

        h3 sl-skeleton {
          width: 30%;
          height: 1.5em;
        }

        @media only screen and (max-width: 700px) {
          #feature {
            border-radius: 0 !important;
            margin: 7px initial !important;
          }
        }

        @media only screen and (min-width: 701px) {
          #feature {
            padding: 30px 40px;
          }
        }
      `,
    ];
  }

  @property({attribute: false})
  user!: User;
  @property({attribute: false})
  paired_user!: User;
  @property({attribute: false})
  featureId = 0;
  @property({attribute: false})
  feature!: Feature;
  @property({attribute: false})
  featureLinks: FeatureLink[] = [];
  @property({attribute: false})
  gates: GateDict[] = [];
  @property({attribute: false})
  comments: string[] = [];
  @property({attribute: false})
  process!: Process;
  @property({attribute: false})
  progress!: ProgressItem;
  @property({attribute: false})
  contextLink = '';
  @property({type: String})
  appTitle = '';
  @property({type: Number})
  selectedGateId = 0;
  @state()
  starred = false;
  @state()
  loading = true;
  @state()
  isUpcoming = false;
  @state()
  hasShipped = false;
  @state()
  currentDate: number = Date.now();
  @state()
  // The closest milestone shipping date as an ISO string.
  closestShippingDate: string = '';

  connectedCallback() {
    super.connectedCallback();
    this.fetchData();
  }

  isFeatureLoaded() {
    return this.feature && Object.keys(this.feature).length !== 0;
  }

  async fetchClosestShippingDate(milestone: number): Promise<string> {
    if (milestone === 0) {
      return '';
    }
    try {
      const newMilestonesInfo = await window.csClient.getSpecifiedChannels(
        milestone,
        milestone
      );
      return newMilestonesInfo[milestone]?.final_beta;
    } catch {
      showToastMessage(
        'Some errors occurred. Please refresh the page or try again later.'
      );
      return '';
    }
  }

  /**
   * Determine if this feature is upcoming - scheduled to ship
   * within two milestones, then find the closest shipping date
   * for that upcoming milestone or an already shipped milestone.*/
  async findClosestShippingDate(channels, stages: Array<StageDict>) {
    const latestStableVersion = channels['stable']?.version;
    if (!latestStableVersion || !stages) {
      return;
    }

    const shippingTypeMilestones = new Set<number | undefined>();
    const otTypeMilestones = new Set<number | undefined>();
    for (const stage of stages) {
      if (STAGE_TYPES_SHIPPING.has(stage.stage_type)) {
        shippingTypeMilestones.add(stage.desktop_first);
        shippingTypeMilestones.add(stage.android_first);
        shippingTypeMilestones.add(stage.ios_first);
        shippingTypeMilestones.add(stage.webview_first);
      }
    }
    for (const stage of stages) {
      if (STAGE_TYPES_ORIGIN_TRIAL.has(stage.stage_type)) {
        otTypeMilestones.add(stage.desktop_first);
        otTypeMilestones.add(stage.android_first);
        otTypeMilestones.add(stage.ios_first);
        otTypeMilestones.add(stage.webview_first);
      }
    }

    const upcomingMilestonesTarget = new Set<number | undefined>([
      ...shippingTypeMilestones,
      ...otTypeMilestones,
    ]);
    // Check if this feature is shipped within two milestones.
    let foundMilestone = 0;
    if (upcomingMilestonesTarget.has(latestStableVersion + 1)) {
      foundMilestone = latestStableVersion + 1;
      this.isUpcoming = true;
    } else if (upcomingMilestonesTarget.has(latestStableVersion + 2)) {
      foundMilestone = latestStableVersion + 2;
      this.isUpcoming = true;
    }

    if (this.isUpcoming) {
      Object.keys(channels).forEach(key => {
        if (channels[key].version === foundMilestone) {
          this.closestShippingDate = channels[key].final_beta;
        }
      });
    } else {
      const shippedMilestonesTarget = shippingTypeMilestones;
      // If not upcoming, find the closest milestone that has shipped.
      let latestMilestone = 0;
      for (const ms of shippedMilestonesTarget) {
        if (ms && ms <= latestStableVersion) {
          latestMilestone = Math.max(latestMilestone, ms);
        }
      }

      if (latestMilestone === latestStableVersion) {
        this.closestShippingDate = channels['stable']?.final_beta;
        this.hasShipped = true;
      } else {
        this.closestShippingDate =
          await this.fetchClosestShippingDate(latestMilestone);
        this.hasShipped = true;
      }
    }
  }

  /**
   * Determine if it should show warnings to a feature author, if
   * a shipped feature is outdated, and it has edit access.*/
  isShippedFeatureOutdatedForAuthor() {
    return this.userCanEdit() && this.isShippedFeatureOutdated();
  }

  /**
   * Determine if it should show warnings to all readers, if
   * a shipped feature is outdated, and last update was > 2 months.*/
  isShippedFeatureOutdatedForAll() {
    if (!this.isShippedFeatureOutdated()) {
      return false;
    }

    // Represent two months grace period.
    const nineWeekPeriod = 9 * 7 * 24 * 60 * 60 * 1000;
    const isVerified = isVerifiedWithinGracePeriod(
      this.feature.accurate_as_of,
      this.currentDate,
      nineWeekPeriod
    );
    return !isVerified;
  }

  /**
   * A feature is outdated if it has shipped, and its
   * accurate_as_of is before its latest shipping date before today.*/
  isShippedFeatureOutdated(): boolean {
    // Check if a feature has shipped.
    if (!this.hasShipped) {
      return false;
    }

    // If accurate_as_of is missing from a shipped feature, it is likely
    // an old feature. Treat it as not oudated.
    if (!this.feature.accurate_as_of) {
      return false;
    }

    return (
      Date.parse(this.feature.accurate_as_of) <
      Date.parse(this.closestShippingDate)
    );
  }

  /**
   * A feature is outdated if it is scheduled to ship in the next 2 milestones,
   * and its accurate_as_of date is at least 4 weeks ago.*/
  isUpcomingFeatureOutdated(): boolean {
    if (!this.isUpcoming) {
      return false;
    }

    const isVerified = isVerifiedWithinGracePeriod(
      this.feature.accurate_as_of,
      this.currentDate
    );
    return !isVerified;
  }

  fetchData() {
    this.loading = true;
    Promise.all([
      window.csClient.getFeature(this.featureId),
      window.csClient.getGates(this.featureId),
      window.csClient.getComments(this.featureId, null),
      window.csClient.getFeatureProcess(this.featureId),
      window.csClient.getStars(),
      window.csClient.getFeatureProgress(this.featureId),
      window.csClient.getChannels(),
    ])
      .then(
        ([
          feature,
          gatesRes,
          commentRes,
          process,
          starredFeatures,
          progress,
          channels,
        ]) => {
          this.feature = feature;
          this.gates = gatesRes.gates;
          this.comments = commentRes.comments;
          this.process = process;
          this.progress = progress;
          if (starredFeatures.includes(this.featureId)) {
            this.starred = true;
          }
          if (this.feature.name) {
            document.title = `${this.feature.name} - ${this.appTitle}`;
          }
          this.findClosestShippingDate(channels, feature.stages);
          this.loading = false;
        }
      )
      .catch(error => {
        if (error instanceof FeatureNotFoundError) {
          this.loading = false;
        } else {
          showToastMessage(
            'Some errors occurred. Please refresh the page or try again later.'
          );
        }
      });

    window.csClient.getFeatureLinks(this.featureId).then(featureLinks => {
      this.featureLinks = featureLinks?.data || [];
      if (featureLinks?.has_stale_links) {
        // delay 10 seconds to fetch server to get latest link information
        setTimeout(this.refetchFeatureLinks.bind(this), 10000);
      }
    });
  }

  async refetchFeatureLinks() {
    const featureLinks = await window.csClient.getFeatureLinks(
      this.featureId,
      false
    );
    this.featureLinks = featureLinks?.data || [];
  }

  refetch() {
    Promise.all([
      window.csClient.getFeature(this.featureId),
      window.csClient.getGates(this.featureId),
      window.csClient.getComments(this.featureId, null),
    ])
      .then(([feature, gatesRes, commentRes]) => {
        this.feature = feature;
        this.gates = gatesRes.gates;
        this.comments = commentRes.comments;
      })
      .catch(error => {
        if (error instanceof FeatureNotFoundError) {
          this.loading = false;
        } else {
          showToastMessage(
            'Some errors occurred. Please refresh the page or try again later.'
          );
        }
      });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.title = this.appTitle;
  }

  handleStarClick(e) {
    e.preventDefault();
    window.csClient.setStar(this.featureId, !this.starred).then(() => {
      this.starred = !this.starred;
    });
  }

  handleShareClick(e) {
    e.preventDefault();
    if (navigator.share) {
      const url = '/feature/' + this.featureId;
      navigator
        .share({
          title: this.feature.name,
          text: this.feature.summary,
          url: url,
        })
        .then(() => {
          ga('send', 'social', {
            socialNetwork: 'web',
            socialAction: 'share',
            socialTarget: url,
          });
        });
    }
  }

  handleCopyLinkClick(e) {
    e.preventDefault();
    const url = e.currentTarget.href;
    navigator.clipboard.writeText(url).then(() => {
      showToastMessage('Link copied');
    });
  }

  canDeleteFeature() {
    return this.user?.is_admin || this.userCanEdit();
  }

  handleArchiveFeature() {
    if (
      !confirm(
        'Archive feature? It will only be visible to users who can edit it'
      )
    )
      return;

    window.csClient.doDelete(`/features/${this.feature.id}`).then(resp => {
      if (resp.message === 'Done') {
        location.href = '/features';
      }
    });
  }

  handleSuspend() {
    if (
      !confirm(
        'Suspend development of this feature? It will not appear on the roadmap.'
      )
    ) {
      return;
    }

    const submitBody = {
      feature_changes: {
        id: this.feature.id,
        impl_status_chrome: IMPLEMENTATION_STATUS.ON_HOLD[0],
      },
      stages: [],
      has_changes: true,
    };
    window.csClient.updateFeature(submitBody).then(resp => {
      window.location.reload();
    });
  }

  handleResume() {
    if (
      !confirm(
        'Resume active development of this feature? It will appear on the roadmap if it has milestones set.'
      )
    ) {
      return;
    }

    const submitBody = {
      feature_changes: {
        id: this.feature.id,
        impl_status_chrome: IMPLEMENTATION_STATUS.PROPOSED[0],
      },
      stages: [],
      has_changes: true,
    };
    window.csClient.updateFeature(submitBody).then(resp => {
      window.location.reload();
    });
  }

  renderSkeletonSection() {
    return html`
      <section>
        <h3><sl-skeleton effect="sheen"></sl-skeleton></h3>
        <p>
          <sl-skeleton effect="sheen"></sl-skeleton>
          <sl-skeleton effect="sheen"></sl-skeleton>
        </p>
      </section>
    `;
  }

  renderSkeletons() {
    return html`
      <div id="feature" style="margin-top: 65px;">
        ${this.renderSkeletonSection()} ${this.renderSkeletonSection()}
        ${this.renderSkeletonSection()} ${this.renderSkeletonSection()}
      </div>
    `;
  }

  featureIsInactive() {
    const status =
      (this.feature && this.feature.browsers.chrome.status.text) || '';
    return INACTIVE_STATES.includes(status);
  }

  userCanEdit() {
    return (
      this.user &&
      (this.user.can_edit_all ||
        this.user.editable_features.includes(this.featureId))
    );
  }

  pairedUserCanEdit() {
    return (
      this.paired_user?.can_edit_all ||
      this.paired_user?.editable_features.includes(this.featureId)
    );
  }

  renderSubHeader() {
    const canShare = typeof navigator.share === 'function';
    return html`
      <div id="subheader" style="display:block">
        <div class="tooltips" style="float:right">
          ${this.user
            ? html`
                <span
                  class="tooltip"
                  title="Receive an email notification when there are updates"
                >
                  <a
                    href="#"
                    data-tooltip
                    id="star-when-signed-in"
                    @click=${this.handleStarClick}
                  >
                    <iron-icon
                      icon=${this.starred
                        ? 'chromestatus:star'
                        : 'chromestatus:star-border'}
                      class="pushicon"
                    ></iron-icon>
                  </a>
                </span>
              `
            : nothing}
          <span class="tooltip" title="File a bug against this feature">
            <a
              href=${ifDefined(this.feature.new_crbug_url)}
              class="newbug"
              data-tooltip
              target="_blank"
              rel="noopener"
            >
              <iron-icon icon="chromestatus:bug-report"></iron-icon>
            </a>
          </span>
          <span
            class="tooltip ${canShare ? '' : 'no-web-share'}"
            title="Share this feature"
          >
            <a
              href="#"
              data-tooltip
              id="share-feature"
              @click=${this.handleShareClick}
            >
              <iron-icon icon="chromestatus:share"></iron-icon>
            </a>
          </span>
          <span
            class="tooltip copy-to-clipboard"
            title="Copy link to clipboard"
          >
            <a
              href="/feature/${this.featureId}"
              data-tooltip
              id="copy-link"
              @click=${this.handleCopyLinkClick}
            >
              <iron-icon icon="chromestatus:link"></iron-icon>
            </a>
          </span>
        </div>
        <h2 id="breadcrumbs">
          <a href="${this.contextLink}">
            <iron-icon icon="chromestatus:arrow-back"></iron-icon>
          </a>
          <a href="/feature/${this.featureId}">
            Feature: ${this.feature.name}
          </a>
          ${this.featureIsInactive()
            ? html`(${this.feature.browsers.chrome.status.text})`
            : nothing}
        </h2>
      </div>
    `;
  }

  renderWarnings() {
    const warnings: TemplateResult[] = [];
    if (this.feature.deleted) {
      warnings.push(html`
        <div id="archived" class="warning">
          This feature is archived. It does not appear in feature lists and is
          only viewable by users who can edit it.
        </div>
      `);
    }
    if (this.feature.unlisted) {
      warnings.push(html`
        <div id="access" class="warning">
          This feature is only shown in the feature list to users with access to
          edit this feature.
        </div>
      `);
    }
    if (!this.userCanEdit() && this.pairedUserCanEdit()) {
      warnings.push(html`
        <div id="switch_to_edit" class="warning">
          User ${this.user.email} cannot edit this feature or request reviews.
          But, ${this.paired_user.email} can do that.
          <br />
          To switch users: sign out and then sign in again.
        </div>
      `);
    }
    if (
      this.user?.approvable_gate_types.length == 0 &&
      this.paired_user?.approvable_gate_types.length > 0
    ) {
      warnings.push(html`
        <div id="switch_to_review" class="warning">
          User ${this.user.email} cannot review this feature. But,
          ${this.paired_user.email} can do that.
          <br />
          To switch users: sign out and then sign in again.
        </div>
      `);
    }
    if (this.isUpcomingFeatureOutdated()) {
      if (this.userCanEdit()) {
        warnings.push(html`
          <div class="warning layout horizontal center">
            <span class="tooltip" id="outdated-icon" title="Feature outdated ">
              <iron-icon icon="chromestatus:error" data-tooltip></iron-icon>
            </span>
            <span>
              Your feature hasn't been verified as accurate since&nbsp;
              <sl-relative-time
                date=${this.feature.accurate_as_of ?? ''}
              ></sl-relative-time
              >, but it is scheduled to ship&nbsp;
              <sl-relative-time
                date=${this.closestShippingDate}
              ></sl-relative-time
              >. Please
              <a href="/guide/verify_accuracy/${this.featureId}"
                >verify that your feature is accurate</a
              >.
            </span>
          </div>
        `);
      } else {
        warnings.push(html`
          <div class="warning layout horizontal center">
            <span class="tooltip" id="outdated-icon" title="Feature outdated ">
              <iron-icon icon="chromestatus:error" data-tooltip></iron-icon>
            </span>
            <span>
              This feature hasn't been verified as accurate since&nbsp;
              <sl-relative-time
                date=${this.feature.accurate_as_of ?? ''}
              ></sl-relative-time
              >, but it is scheduled to ship&nbsp;
              <sl-relative-time
                date=${this.closestShippingDate}
              ></sl-relative-time
              >.
            </span>
          </div>
        `);
      }
    }

    if (this.isShippedFeatureOutdated()) {
      if (this.isShippedFeatureOutdatedForAuthor()) {
        warnings.push(html`
          <div class="warning layout horizontal center">
            <span
              class="tooltip"
              id="shipped-outdated-author"
              title="Feature outdated "
            >
              <iron-icon icon="chromestatus:error" data-tooltip></iron-icon>
            </span>
            <span>
              Your feature hasn't been verified as accurate since&nbsp;
              <sl-relative-time
                date=${this.feature.accurate_as_of ?? ''}
              ></sl-relative-time
              >, but it claims to have shipped&nbsp;
              <sl-relative-time
                date=${this.closestShippingDate}
              ></sl-relative-time
              >. Please
              <a href="/guide/verify_accuracy/${this.featureId}"
                >verify that your feature is accurate</a
              >.
            </span>
          </div>
        `);
      } else if (this.isShippedFeatureOutdatedForAll()) {
        warnings.push(html`
          <div class="warning layout horizontal center">
            <span
              class="tooltip"
              id="shipped-outdated-all"
              title="Feature outdated "
            >
              <iron-icon icon="chromestatus:error" data-tooltip></iron-icon>
            </span>
            <span>
              This feature hasn't been verified as accurate since&nbsp;
              <sl-relative-time
                date=${this.feature.accurate_as_of ?? ''}
              ></sl-relative-time
              >, but it claims to have shipped&nbsp;
              <sl-relative-time
                date=${this.closestShippingDate}
              ></sl-relative-time
              >.
            </span>
          </div>
        `);
      }
    }
    return warnings;
  }

  renderFeatureDetails() {
    return html`
      <chromedash-feature-detail
        appTitle=${this.appTitle}
        .loading=${this.loading}
        .user=${this.user}
        ?canEdit=${this.userCanEdit()}
        .feature=${this.feature}
        .gates=${this.gates}
        .comments=${this.comments}
        .process=${this.process}
        .progress=${this.progress}
        .featureLinks=${this.featureLinks}
        selectedGateId=${this.selectedGateId}
      >
      </chromedash-feature-detail>
    `;
  }

  render() {
    // TODO: create another element - chromedash-feature-highlights
    // for all the content of the <div id="feature"> part of the page
    // If loading, only render the skeletons.
    if (this.loading) {
      return this.renderSkeletons();
    }
    // If after loading, the feature did not load, render nothing.
    if (!this.isFeatureLoaded()) {
      return html`Feature not found.`;
    }
    // At this point, the feature has loaded successfully, render the components.
    return html`
      ${this.renderSubHeader()} ${this.renderWarnings()}
      <chromedash-feature-highlights
        .feature=${this.feature}
        .featureLinks=${this.featureLinks}
        ?canDeleteFeature=${this.canDeleteFeature()}
        ?canEditFeature=${this.userCanEdit()}
        @archive=${this.handleArchiveFeature}
        @suspend=${this.handleSuspend}
        @resume=${this.handleResume}
      ></chromedash-feature-highlights>
      ${this.renderFeatureDetails()}
    `;
  }
}
