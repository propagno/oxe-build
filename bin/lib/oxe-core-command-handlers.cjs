'use strict';

const { createCommandRegistry } = require('./oxe-command-registry.cjs');

/** Build the high-level CLI handlers from explicit parser/domain dependencies. */
function createCoreCommandRegistry(deps) {
  const {
    existsSync, printBanner, usage, runtimeUsage, log, error, exit, colors,
    readPkgVersion, parseUninstallArgs, parseUpdateArgs, parseCapabilitiesArgs,
    parseRuntimeArgs, parseAzureArgs, parseInstallArgs, runUninstall,
    runUpdateVersionCheck, runUpdate, runCapabilities, runRuntime, runAzure,
    runDoctor, runStatus, runStatusFull,
  } = deps;

  function showParseFailure(opts, customUsage) {
    const printHelp = typeof customUsage === 'function' ? () => customUsage(opts) : usage;
    if (opts.conflictFlags) {
      printBanner(); error(`${colors.red}${opts.conflictFlags}${colors.reset}`); printHelp(); exit(1);
    }
    if (opts.parseError) {
      printBanner(); error(`${colors.red}Opção desconhecida:${colors.reset} ${opts.unknownFlag}`); printHelp(); exit(1);
    }
  }
  function showHelp(opts) {
    if (opts.version) { log(`oxe-cc v${readPkgVersion()}`); exit(0); }
    if (!opts.help) return;
    printBanner(); usage(); exit(0);
  }
  function requireDirectory(dir, allowMissing) {
    if (allowMissing || existsSync(dir)) return;
    error(`${colors.yellow}Diretório não encontrado: ${dir}${colors.reset}`); exit(1);
  }

  return createCommandRegistry([
    { name: 'uninstall', handler(argv) {
      const opts = parseUninstallArgs(argv);
      showHelp(opts); showParseFailure(opts); printBanner(); requireDirectory(opts.dir, opts.dryRun);
      return runUninstall(opts);
    } },
    { name: 'update', handler(argv) {
      const opts = parseUpdateArgs(argv);
      showHelp(opts); showParseFailure(opts); printBanner();
      if (opts.check) return runUpdateVersionCheck(opts);
      requireDirectory(opts.dir, opts.dryRun);
      return runUpdate(opts);
    } },
    { name: 'capabilities', handler(argv) {
      const opts = parseCapabilitiesArgs(argv);
      showHelp(opts); showParseFailure(opts); printBanner(); requireDirectory(opts.dir, false);
      return runCapabilities(opts);
    } },
    { name: 'runtime', async handler(argv) {
      const opts = parseRuntimeArgs(argv);
      showHelp(opts); showParseFailure(opts, runtimeUsage); if (!opts.jsonOutput) printBanner(); requireDirectory(opts.dir, false);
      return runRuntime(opts);
    } },
    { name: 'azure', handler(argv) {
      const opts = parseAzureArgs(argv);
      showHelp(opts); showParseFailure(opts); printBanner();
      return runAzure(opts);
    } },
    { name: 'doctor', handler(argv) {
      const opts = parseInstallArgs(argv);
      showHelp(opts); showParseFailure(opts);
      if (!opts.jsonOutput) printBanner();
      requireDirectory(opts.dir, false);
      return runDoctor(opts.dir, {
        release: opts.releaseDoctor, project: opts.projectDoctor, ciParity: opts.ciParity, json: opts.jsonOutput, writeManifest: opts.writeManifest,
        migrateConfig: opts.migrateConfig, applyMigration: opts.applyMigration,
      });
    } },
    { name: 'status', handler(argv) {
      const opts = parseInstallArgs(argv);
      showHelp(opts); showParseFailure(opts);
      if (!opts.jsonOutput) printBanner();
      requireDirectory(opts.dir, false);
      return (opts.statusFull && !opts.jsonOutput)
        ? runStatusFull(opts.dir)
        : runStatus(opts.dir, { json: opts.jsonOutput, ...(opts.statusFull ? { full: true } : {}), hints: opts.statusHints, summary: opts.statusSummary, allWorktrees: opts.allWorktrees, ...(opts.statusJourney ? { journey: true } : {}) });
    } },
  ]);
}

module.exports = { createCoreCommandRegistry };
