function convertVersion(version) {
    let versions = version.split('.');
    if (versions.length < 3) {
        throw new Error(`Invalid version format: ${version}. Expected format is 'major.minor.patch'.`);
    }

    let major = parseInt(versions[0], 10);
    let minor = parseInt(versions[1], 10);
    let patch = parseInt(versions[2], 10);

    return major*10000000000+minor*100000+patch
}

function parseVersion(version) {
    // from uint to version string
    let major = Math.floor(version / 10000000000);
    let minor = Math.floor((version % 10000000000) / 100000);
    let patch = version % 100000;
    return `${major}.${minor}.${patch}`;
}

function test(version) {
    console.log(`version: ${version}, converted: ${convertVersion(version)},  parsed: ${parseVersion(convertVersion(version))}`);
}

test("0.8.20");
test("0.0.1");
test("1.0.0");
test("1.2.3");
test("10.20.30");
test("255.65535.65535");