import { EvmLogHandlerContext } from '@subsquid/substrate-processor';
import { Store } from '@subsquid/typeorm-store';
import assert from 'assert';
import {
	ERC721Contract,
	ERC721Owner,
	ERC721Token,
	ERC721Transfer,
	Metadata,
} from '../model';
import * as erc721 from '../abi/erc721';
import {
	ERC721contract,
	ERC721owner,
	ERC721token,
	ERC721transfer,
	metadata,
} from '../utils/entitiesManager';
import { parseMetadata } from '../helpers/metadata.helper';
// import {
// 	getTokenId,
// 	getOrCreateERC721Owner,
// 	updateERC721TokenMetadata,
// } from '../helpers';
import { NULL_ADDRESS, TOKEN_RELATIONS } from '../utils/config';

export async function erc721handleTransfer(
	ctx: EvmLogHandlerContext<Store>
): Promise<void> {
	const { event, block, store } = ctx;
	const evmLog = event.args;
	const contractAddress = evmLog.address.toLowerCase() as string;
	const contractAPI = new erc721.Contract(ctx, contractAddress);
	const data =
		erc721.events['Transfer(address,address,uint256)'].decode(evmLog);
	const [name, symbol, contractURI, totalSupply, tokenUri] =
		await Promise.all([
			contractAPI.name(),
			contractAPI.symbol(),
			contractAPI.contractURI(),
			contractAPI.totalSupply(),
			contractAPI.tokenURI(data.tokenId),
		]);
	let oldOwner = await ERC721owner.get(
		ctx.store,
		ERC721Owner,
		data.from.toLowerCase()
	);
	if (oldOwner == null) {
		oldOwner = new ERC721Owner({
			id: data.from.toLowerCase(),
			balance: 0n,
		});
	}

	let owner = await ERC721owner.get(
		ctx.store,
		ERC721Owner,
		data.to.toLowerCase()
	);
	if (owner == null) {
		owner = new ERC721Owner({
			id: data.to.toLowerCase(),
			balance: 0n,
		});
	}

	if (
		oldOwner.balance != null &&
		oldOwner.balance > BigInt(0) &&
		oldOwner.id != '0x0000000000000000000000000000000000000000'
	) {
		oldOwner.balance = oldOwner.balance - BigInt(1);
	}

	if (owner.balance != null) {
		owner.balance = owner.balance + BigInt(1);
	}

	ERC721owner.save(oldOwner);
	ERC721owner.save(owner);

	let contractData = await ERC721contract.get(
		ctx.store,
		ERC721Contract,
		contractAddress
	);
	if (contractData == null) {
		contractData = new ERC721Contract({
			id: contractAddress,
			address: contractAddress,
			name: name,
			symbol: symbol,
			totalSupply: totalSupply.toBigInt(),
			decimals: 0,
			contractURI: contractURI,
			contractURIUpdated: BigInt(block.timestamp),
		});
	} else {
		contractData.name = name;
		contractData.symbol = symbol;
		contractData.totalSupply = totalSupply.toBigInt();
		contractData.contractURI = contractURI;
		contractData.contractURIUpdated = BigInt(block.timestamp);
	}
	ERC721contract.save(contractData);

	let metadatId = contractAddress + '-' + data.tokenId.toString();
	let meta = await metadata.get(ctx.store, Metadata, metadatId);
	if (!meta) {
		meta = await parseMetadata(ctx, tokenUri, metadatId);
		if (meta) metadata.save(meta);
	}

	let token = await ERC721token.get(
		ctx.store,
		ERC721Token,
		metadatId,
		TOKEN_RELATIONS
	);
	// assert(token);
	if (!token) {
		token = new ERC721Token({
			id: metadatId,
			numericId: data.tokenId.toBigInt(),
			owner,
			tokenUri,
			metadata: meta,
			contract: contractData,
			updatedAt: BigInt(block.timestamp),
			createdAt: BigInt(block.timestamp),
		});
	} else {
		token.owner = owner;
	}
	ERC721token.save(token);

	let transferId = block.hash
		.concat('-'.concat(data.tokenId.toString()))
		.concat('-'.concat(event.indexInBlock.toString()));
	let transfer = await ERC721transfer.get(
		ctx.store,
		ERC721Transfer,
		transferId
	);
	if (!transfer) {
		transfer = new ERC721Transfer({
			id: transferId,
			block: block.height,
			timestamp: BigInt(block.timestamp),
			transactionHash: block.hash,
			from: oldOwner,
			to: owner,
			token,
		});
	}
	ERC721transfer.save(transfer);
	console.log('ERC721Transfer', transfer);
}