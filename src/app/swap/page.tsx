"use client";
import {
  ACTIVE_CHAIN,
  CoinMingleRouter,
  NULL_ADDRESS,
  EXPLORER,
} from "@config";
import { formatToken, parseToken } from "@utils";
import { ChangeEvent, FormEvent, useState } from "react";
import { Toaster, toast } from "react-hot-toast";
import { TransactionReceipt, parseUnits } from "viem";
import {
  erc20ABI,
  useAccount,
  useContractReads,
  useContractRead,
  useToken,
  useNetwork,
  useSwitchNetwork,
  useContractWrite,
  useWaitForTransaction,
} from "wagmi";
import CM_ROUTER from "@abis/Router.json";
import TOKENS from "@db/tokens.json";
import Image from "next/image";

export default function Swap() {
  const [tokenInput, setTokenInput] = useState({
    tokenA: "",
    tokenB: "",
    fetch: false,
  });

  const [activeToken, setActiveToken] = useState<{
    tokenA?: string;
    tokenB?: string;
  }>({
    tokenA: "0xf1277d1ed8ad466beddf92ef448a132661956621",
  });

  const [openModal, setOpenModal] = useState(false);
  const [tokenAOpened, setTokenAOpened] = useState(false);

  const { address, isConnected } = useAccount();
  /** @dev switching chain if not connected to ftm */
  const { chain: connectedChain } = useNetwork();
  const { isLoading: isSwitchingChain, switchNetworkAsync } = useSwitchNetwork({
    chainId: ACTIVE_CHAIN.id,
  });

  /** @dev Read tokenA data */
  const { data: tokenA_data } = useToken({
    address: activeToken?.tokenA as `0x`,
    chainId: ACTIVE_CHAIN.id,
    enabled: isConnected && activeToken?.tokenA ? true : false,
  });
  /** @dev Read tokenB data */
  const { data: tokenB_data } = useToken({
    address: activeToken?.tokenB as `0x`,
    chainId: ACTIVE_CHAIN.id,
    enabled: isConnected && activeToken?.tokenB ? true : false,
  });

  /** @dev Fetching the balances of selected token */
  const {
    data: balanceOf,
    isFetched: isBalanceFetched,
    refetch: refetchBalances,
  } = useContractReads({
    contracts: [
      {
        address: activeToken?.tokenA as `0x`,
        abi: erc20ABI,
        functionName: "balanceOf",
        args: [address as `0x`],
      },
      {
        address: activeToken?.tokenB as `0x`,
        abi: erc20ABI,
        functionName: "balanceOf",
        args: [address as `0x`],
      },
    ],
    watch: true,
  });

  const { data: pairAddress } = useContractRead({
    address: CoinMingleRouter as `0x`,
    abi: CM_ROUTER.abi,
    functionName: "getPair",
    args: [activeToken?.tokenA, activeToken?.tokenB],
    watch: true,
    enabled:
      isConnected && activeToken?.tokenA && activeToken?.tokenB ? true : false,
    onSuccess(data) {
      if (data === NULL_ADDRESS) {
        toast.error("No pair available");
      }
    },
  });

  const { data: perTokenOut, refetch: refetchPerTokenOut } = useContractRead({
    address: CoinMingleRouter as `0x`,
    abi: CM_ROUTER.abi,
    functionName: "getAmountOut",
    args: [
      parseToken("1", tokenA_data?.decimals),
      [activeToken?.tokenA, activeToken?.tokenB],
    ],
    enabled: pairAddress !== NULL_ADDRESS ? true : false,
    watch: true,
  });

  const { data: approval } = useContractRead({
    address: activeToken.tokenA as "0x",
    abi: erc20ABI,
    functionName: "allowance",
    args: [address as "0x", CoinMingleRouter],
    enabled: isConnected && activeToken.tokenA ? true : false,
    watch: true,
  });

  const {
    data: approvalData,
    isLoading: isApprove,
    writeAsync: giveApproval,
  } = useContractWrite({
    address: activeToken.tokenA as "0x",
    abi: erc20ABI,
    functionName: "approve",
    args: [
      CoinMingleRouter,
      // @ts-ignore
      tokenA_data?.totalSupply.value,
    ],
  });

  const {
    data: amountOut,
    isFetched: isAmountOutFetched,
    isFetching: isFetchingAmountOut,
  } = useContractRead({
    address: CoinMingleRouter as `0x`,
    abi: CM_ROUTER.abi,
    functionName: "getAmountOut",
    args: [
      parseToken(tokenInput.tokenA, tokenA_data?.decimals),
      [activeToken?.tokenA, activeToken?.tokenB],
    ],
    enabled:
      pairAddress && pairAddress !== NULL_ADDRESS && tokenInput.fetch
        ? true
        : false,
    watch: true,
    onSuccess(data) {
      setTokenInput((prev) => ({
        ...prev,
        tokenB: formatToken(data as BigInt, tokenB_data?.decimals) as string,
      }));
    },
  });

  const {
    data: swapHash,
    writeAsync: swap,
    isLoading: isSwapping,
  } = useContractWrite({
    address: CoinMingleRouter,
    abi: CM_ROUTER.abi,
    functionName: "swapTokensForTokens",
    args: [
      parseToken(tokenInput.tokenA, tokenA_data?.decimals),
      amountOut,
      [activeToken?.tokenA, activeToken?.tokenB],
      address,
      Math.round(+new Date() / 1000) + 300,
    ],
  });

  /** @dev Handling onTransactionError */
  const onError = async (err: Error) => {
    toast.error(err.name);
    console.log(err);
  };

  /** @dev Handling onTransactionReceipt (MINE) */
  const onReceipt = async (data: TransactionReceipt) => {
    toast.success(
      <a
        target="_blank"
        href={`${EXPLORER}/tx/${data.transactionHash}`}
        className="underline"
      >
        View Transaction
      </a>,
      {
        duration: 10000,
      }
    );
  };

  /** @dev Waiting for tx to mine */
  const { isFetching } = useWaitForTransaction({
    hash: swapHash?.hash || approvalData?.hash,
    onSuccess: onReceipt,
    onError,
  });

  /** @dev Handling form changing event */
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const match = /^\d*\.?\d*$/.test(e.target.value);
    if (match) {
      setTokenInput((prev) => {
        if (!e.target.value) {
          return {
            tokenA: "",
            tokenB: "",
            fetch: false,
          };
        }
        return {
          ...prev,
          fetch: true,
          [e.target.name]: e.target.value && e.target.value,
        };
      });
    }
  };

  const reverseSwap = () => {
    setActiveToken((prev) => ({
      tokenA: prev?.tokenB,
      tokenB: prev?.tokenA,
    }));

    setTokenInput((prev) => ({
      ...prev,
      tokenA: prev.tokenB,
      tokenB: prev.tokenA,
    }));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();

    /** @dev If wallet is not connected then return with error */
    if (!isConnected) {
      toast.error(`Connect wallet first.`);
      return;
    }

    /** @dev Switching chain if correct chain is not connected */
    if (connectedChain?.id != ACTIVE_CHAIN.id) {
      const loadingToast = toast.loading("Switching to FTM...");
      try {
        switchNetworkAsync && (await switchNetworkAsync());
        toast.success("Switched");
      } catch (e: any) {
        onError(e);
      } finally {
        toast.dismiss(loadingToast);
      }
      return;
    }

    if (tokenA_data?.totalSupply.value && tokenInput.tokenA) {
      if (
        // @ts-ignore
        approval < parseUnits(tokenInput.tokenA as "0", tokenA_data.decimals)
      ) {
        const loadingToast = toast.loading("Approving...");
        try {
          await giveApproval();
          toast.success("Approved");
        } catch (e: any) {
          onError(e);
        } finally {
          toast.dismiss(loadingToast);
        }
        return;
      }
    }

    const loadingToast = toast.loading("Swapping...");
    try {
      await swap();
      toast.success("Swapped");
    } catch (e: any) {
      onError(e);
    } finally {
      toast.dismiss(loadingToast);
      setTokenInput(() => ({
        tokenA: "",
        tokenB: "",
        fetch: false,
      }));

      refetchBalances();
      refetchPerTokenOut();
    }
  };

  const close = (address: string) => {
    if (tokenAOpened) {
      setActiveToken((prev) => ({
        ...prev,
        tokenA: address,
      }));
    } else {
      setActiveToken((prev) => ({
        ...prev,
        tokenB: address,
      }));
    }
    setOpenModal(false);
  };

  const open = (isTokenA: boolean) => {
    if (isTokenA) {
      setTokenAOpened(true);
    } else {
      setTokenAOpened(false);
    }
    setOpenModal(true);
  };

  return (
    <div className="justify-evenly flex flex-col gap-16">
      <header className="text-center flex flex-col gap-4">
        <h1 className="text-2xl">Swap</h1>
        <p className="text-md text-slate-300 max-w-xl text-center">
          Exchange one token for another directly through the smart contract.
          The swap feature calculates the conversion rate based on the available
          liquidity in the pool.
        </p>
      </header>

      <form className="w-[35rem] flex flex-col gap-2" onSubmit={onSubmit}>
        <div
          className={`flex flex-col items-center justify-center gap-2 h-32 px-4 transition-all ${
            isFetchingAmountOut ? "bg-slate-200" : "bg-white"
          } bg-opacity-20 backdrop-blur-3xl rounded-2xl`}
        >
          <div className="flex gap-3 items-center justify-center">
            <input
              type="text"
              placeholder="0"
              name="tokenA"
              value={tokenInput.tokenA}
              onChange={onChange}
              disabled={isFetchingAmountOut}
              className="w-full h-12 px-4 bg-transparent outline-none text-4xl"
              required
              autoFocus
            />
            <div
              className="flex gap-4 justify-center items-center px-5 py-2 cursor-pointer border border-slate-100 rounded-2xl"
              onClick={() => open(true)}
            >
              <p className="font-semibold">{tokenA_data?.symbol}</p>
              <p className="text-2xl">&#8650;</p>
            </div>
          </div>
          <div className="flex w-full justify-between items-center px-4 mt-1">
            <div></div>
            {isBalanceFetched && (
              <p className="text-sm text-slate-300">
                Balance:{" "}
                {formatToken(balanceOf?.[0].result, tokenA_data?.decimals)}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center justify-center cursor-pointer">
          <h1
            className=" w-fit px-5 py-4 text-center text-[1.5rem] bg-white bg-opacity-20 backdrop-blur-3xl rounded-full"
            onClick={reverseSwap}
          >
            &#8693;
          </h1>
        </div>

        <div
          className={`flex flex-col items-center justify-center gap-2 h-32 px-4 transition-all ${
            isFetchingAmountOut ? "bg-slate-200" : "bg-white"
          } bg-opacity-20 backdrop-blur-3xl rounded-2xl`}
        >
          <div className="flex gap-3 items-center justify-center">
            <input
              type="text"
              placeholder="0"
              name="tokenB"
              value={tokenInput.tokenB}
              readOnly
              className="w-full h-12 px-4 bg-transparent outline-none text-4xl"
            />
            <div
              className="flex gap-4 justify-center items-center px-5 py-2 cursor-pointer border border-slate-100 rounded-2xl"
              onClick={() => open(false)}
            >
              <p className="font-semibold">{tokenB_data?.symbol}</p>
              <p className="text-2xl">&#8650;</p>
            </div>
          </div>
          <div className="flex w-full justify-between items-center px-4 mt-1">
            <div></div>
            {isBalanceFetched && (
              <p className="text-sm text-slate-300">
                Balance:{" "}
                {formatToken(balanceOf?.[1].result, tokenB_data?.decimals)}
              </p>
            )}
          </div>
        </div>

        {activeToken?.tokenA && activeToken.tokenB && (
          <>
            <div className="flex items-center justify-between mt-2 text-sm">
              <p className="flex items-center justify-center text-slate-300">
                1 {tokenB_data?.symbol} ={" "}
                {formatToken(perTokenOut as BigInt, tokenB_data?.decimals)}{" "}
                {tokenA_data?.symbol}
              </p>
              <p className="flex items-center justify-center text-slate-300">
                Expected Output :{" "}
                {formatToken(amountOut as BigInt, tokenB_data?.decimals)}{" "}
                {tokenB_data?.symbol}
              </p>
            </div>

            <div className="mt-1 flex justify-between items-center">
              <p className="">
                {tokenA_data?.symbol} <span>&#8674;</span> {tokenB_data?.symbol}
              </p>
              <p className="text-slate-300 text-sm">Deadline : 10m</p>
            </div>
          </>
        )}

        <button
          type="submit"
          disabled={
            isSwitchingChain ||
            isApprove ||
            isSwapping ||
            isFetching ||
            (balanceOf?.[0] &&
              // @ts-ignore
              balanceOf[0].result <
                // @ts-ignore
                parseUnits(tokenInput.tokenA as "0", tokenA_data.decimals)) ||
            !isAmountOutFetched
          }
          className="btn w-full mt-10"
        >
          {isSwitchingChain
            ? "Switching Chain..."
            : isSwapping
            ? "Swapping..."
            : isApprove
            ? "Approving..."
            : connectedChain?.id != ACTIVE_CHAIN.id && isConnected
            ? "Switch to FTM"
            : balanceOf?.[0] &&
              // @ts-ignore
              balanceOf[0].result <
                // @ts-ignore
                parseUnits(tokenInput.tokenA as "0", tokenA_data.decimals)
            ? "Insufficient Balance"
            : tokenA_data?.totalSupply.value &&
              // @ts-ignore
              approval <
                parseUnits(tokenInput.tokenA as "0", tokenA_data.decimals)
            ? "Approve"
            : "Swap"}
        </button>
      </form>

      {openModal && (
        <div className="cursor-pointer flex justify-center items-center fixed top-0 left-0 right-0 z-50 w-screen h-screen bg-white bg-opacity-10 backdrop-blur-sm">
          <div className="w-[27rem] h-[70%] bg-slate-200 bg-opacity-30 backdrop-blur-xl rounded-3xl text-white">
            <div className="overflow-x-scroll h-[85%] flex flex-col gap-5 py-7 px-4">
              {TOKENS.map((token) =>
                tokenAOpened
                  ? token.address !== activeToken.tokenB && (
                      <div
                        className="border rounded-3xl border-slate-100 border-opacity-40 py-2 px-5 flex items-center gap-3"
                        key={token.address}
                        onClick={() => close(token.address)}
                      >
                        <Image
                          src="/ftm-logo.svg"
                          alt=""
                          width={30}
                          height={30}
                        />
                        <div className="">
                          <p className="text-lg">{token.name}</p>
                          <p className="text-sm">{token.symbol}</p>
                        </div>
                      </div>
                    )
                  : token.address !== activeToken.tokenA && (
                      <div
                        className="border rounded-3xl border-slate-100 border-opacity-40 py-2 px-5 flex items-center gap-3"
                        key={token.address}
                        onClick={() => close(token.address)}
                      >
                        <Image
                          src="/ftm-logo.svg"
                          alt=""
                          width={30}
                          height={30}
                        />
                        <div className="">
                          <p className="text-lg">{token.name}</p>
                          <p className="text-sm">{token.symbol}</p>
                        </div>
                      </div>
                    )
              )}
            </div>
          </div>
        </div>
      )}

      <Toaster />
    </div>
  );
}
