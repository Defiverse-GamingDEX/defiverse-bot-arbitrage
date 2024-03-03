# Arbitrage

Description: In this repo, it supports pair arbitrage and triangle arbitrage. Pair Arbitrage is an arbitrage opportunity that appears between two currencies in two pools that don’t have equivalent conversion rates. Triangle Arbitrage is an arbitrage opportunity that appears between three currencies that don’t have equivalent conversion rates

## Prerequisite:
- Nodejs(Library Expressjs)
- Postgres database: store transactions, config, actions
- Telegram: send command to backend and receive arbitrage information


## Basic Tutorial
In this tutorial, we will be going over how to create and run a arbitrage bot for the Defiverse network.

1. Prepare the `.env` file which copied from `.default.env`
    - PORT: is port of arbitrage. 
    - INIT_DB: will init all tables(in the first time you run), or will drop all tables if it already existed and create again.
    - DB_URI: is uri of database
    - TELEGRAM_TOKEN: is telegram token
    - SIGNER_PRIVATE_KEY: is private key of your account that you use to sign and send transaction
    - SIGNER_ADDRESS: is your account address that you use to sign and send transaction
    - VAULT_SC_ADDRESS: is the Vault smart contract address
    - NETWORK: the network which our bot will run. There are two networks, we can config
        + DEFIVERSE_TESTNET: the network is for the defiverse testnet
        + DEFIVERSE: the network is for the defiverse mainnet
2. Prepare pairs for trading. There are two files, we need to update. 
    - `defi-mainnet.pair.json`: The file is for the defiverse mainnet.
    - `defi-testnet.pair.json`: The file is for the defiverse testnet.

    ##### The content in the files will contain information related to `RETRY`, `PAIR_ARBITRAGE` and `TRIANGLE_ARBITRAGE`.

    - `RETRY`: the retry limit that we will try to get the maximum profit
    - `PAIR_ARBITRAGE`, we can configure the flash amount that we use to trade, and the list of pair pools
    - `TRIANGLE_ARBITRAGE`, we can configure the amount that we use to trade, and the list of pool and token symbols. We will contain some information as below:
        + `minProfit`: the minimum profit that we want to earn. The profit will be calculated with the first token. For example: the triangle "USDC-GDT-WOAS", we configure minProfit 2,  which means we will earn the minimum of 2 USDC
        + `milestone`: the milestone we will increase after retrying to get the maximum profit
        + `symbols`: There are three tokens to make the triangle.
        + `pairs`: There are three pool ids to make the triangle.Please note the orders of the pairs; they should match the symbol order. For example: USDC-GDT-WOAS we will have three pairs with the order like this
            ```
                1/ "0x26cdeaf40cf9a83bb7436b560d150c1d5d98b87900020000000000000000000a" // USDC-GDT
                2/ "0xaa01a32965a072082dac7169b4c9457ce1508be5000200000000000000000001" // GDT-WOAS
                3/ "0xe815154dc2bb9cceee8054b01e99850b2a8c0d1e000200000000000000000002" // WOAS-USDC
            ```


3. Install all dependencies:

    ```
    yarn install
    ```

4. Start our project

    ```
    yarn start
    ```

5. Go telegram 
    - Create a group on the Telegram
    - Add the telegram bot which have the token we are setting up before
    - Run the command in the Telegram message `/start`