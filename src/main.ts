const InitModule = (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer) => {
  logger.info('TypeScript module loaded.');
};

// Reference InitModule to avoid it getting removed on build
!InitModule && InitModule.bind(null);
