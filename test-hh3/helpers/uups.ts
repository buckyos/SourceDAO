export async function deployUUPSProxy(
    ethers: any,
    contractName: string,
    initializerArgs: unknown[] = [],
    initializer = "initialize"
) {
    const implementationFactory = await ethers.getContractFactory(contractName);
    const implementation = await implementationFactory.deploy();
    await implementation.waitForDeployment();

    const initializerData = implementationFactory.interface.encodeFunctionData(
        initializer,
        initializerArgs
    );

    const proxyFactory = await ethers.getContractFactory("ERC1967Proxy");
    const proxy = await proxyFactory.deploy(
        await implementation.getAddress(),
        initializerData
    );
    await proxy.waitForDeployment();

    return implementationFactory.attach(await proxy.getAddress());
}