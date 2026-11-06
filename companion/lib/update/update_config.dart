/// GitHub repository (`owner/name`) whose `companion-v*` releases the startup
/// check reads. Override at build time with `--dart-define=UPDATE_REPO=owner/name`;
/// an empty value turns the check off.
const updateRepoDefine = String.fromEnvironment(
  'UPDATE_REPO',
  defaultValue: 'shokkzu/forever-tracker',
);
