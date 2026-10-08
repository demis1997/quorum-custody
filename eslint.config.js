import tseslint from 'typescript-eslint';
export default tseslint.config(...tseslint.configs.recommended,{
 files:['**/*.ts','**/*.tsx'],rules:{'@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_',caughtErrors:'none'}],'no-empty':['error',{allowEmptyCatch:true}]}
});
