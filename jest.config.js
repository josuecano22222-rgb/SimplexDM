module.exports = {
    testEnvironment: 'jsdom',
    roots: ['<rootDir>/tests'],
    testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],
    collectCoverageFrom: [
        'public/js/**/*.js',
        '!public/js/lib/**',
        '!public/js/**/*.min.js'
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/public/$1'
    },
    transform: {
        '^.+\\.js$': 'babel-jest'
    },
    testTimeout: 10000
};
