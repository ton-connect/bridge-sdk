const globals = require('globals');
const base = require('@ton/toolchain');

module.exports = [
    ...base,
    {
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
    },
];
