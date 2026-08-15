// The pinned sub-header shared by BOTH My-Collection views (Sets landing + All
// grid). Since Phase 5 this is a thin adapter over the shared AppBar primitive -
// AppBar's sticky band IS this component's old frost recipe, promoted app-wide.
// The band stays always-present (announce off: its mount is a view render, not a
// forward navigation).
import React from 'react';
import AppBar from './AppBar.jsx';

export default function CollectionSubHeader({ title, tally, tallyLive = false, tallyEmphasis = false, action = null }) {
  return (
    <AppBar variant="sub" sticky announce={false}
      eyebrow="Collection" eyebrowColor="var(--accent-ruby)"
      title={title} meta={tally} metaLive={tallyLive} metaEmphasis={tallyEmphasis}
      trailing={action} />
  );
}
