// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title BiteIntentStore
/// @notice Stores encrypted intent blobs for SKALE BITE protocol.
///         Payment confirmation on Base triggers conditional decryption.

interface IBiteSupplicant {
    function onDecrypt(bytes32 intentId, bytes calldata plaintext) external;
}

contract BiteIntentStore is IBiteSupplicant {
    struct Intent {
        bytes32 intentId;
        address owner;
        bytes encryptedBlob;
        bytes decryptedBlob;
        bool paid;
        bool revealed;
        uint256 storedAt;
    }

    mapping(bytes32 => Intent) public intents;

    event IntentStored(bytes32 indexed intentId, address indexed owner, uint256 blobSize);
    event IntentPaid(bytes32 indexed intentId);
    event IntentRevealed(bytes32 indexed intentId, uint256 plaintextSize);

    /// @notice Store an encrypted intent blob
    /// @param intentId Unique identifier for the intent
    /// @param encryptedBlob The BITE-encrypted intent data
    function storeIntent(bytes32 intentId, bytes calldata encryptedBlob) external {
        require(intents[intentId].storedAt == 0, "Intent already exists");

        intents[intentId] = Intent({
            intentId: intentId,
            owner: msg.sender,
            encryptedBlob: encryptedBlob,
            decryptedBlob: "",
            paid: false,
            revealed: false,
            storedAt: block.timestamp
        });

        emit IntentStored(intentId, msg.sender, encryptedBlob.length);
    }

    /// @notice Mark an intent as paid (called after Base payment settlement)
    /// @param intentId The intent to mark as paid
    function markPaid(bytes32 intentId) external {
        Intent storage intent = intents[intentId];
        require(intent.storedAt > 0, "Intent does not exist");
        require(!intent.paid, "Already paid");
        require(msg.sender == intent.owner, "Only owner can mark paid");

        intent.paid = true;
        emit IntentPaid(intentId);

        // BITE conditional decrypt will fire on next block
        // when the protocol detects the paid flag
    }

    /// @notice BITE callback - called by the SKALE BITE protocol when decryption occurs
    /// @param intentId The intent being decrypted
    /// @param plaintext The decrypted intent data
    function onDecrypt(bytes32 intentId, bytes calldata plaintext) external override {
        Intent storage intent = intents[intentId];
        require(intent.storedAt > 0, "Intent does not exist");
        require(intent.paid, "Intent not paid");
        require(!intent.revealed, "Already revealed");

        intent.decryptedBlob = plaintext;
        intent.revealed = true;

        emit IntentRevealed(intentId, plaintext.length);
    }

    /// @notice Retrieve intent data
    /// @param intentId The intent to retrieve
    /// @return owner The intent owner
    /// @return paid Whether payment has been confirmed
    /// @return revealed Whether decryption has occurred
    /// @return data The decrypted data (empty if not yet revealed)
    function getIntent(bytes32 intentId) external view returns (
        address owner,
        bool paid,
        bool revealed,
        bytes memory data
    ) {
        Intent storage intent = intents[intentId];
        require(intent.storedAt > 0, "Intent does not exist");

        return (
            intent.owner,
            intent.paid,
            intent.revealed,
            intent.revealed ? intent.decryptedBlob : bytes("")
        );
    }
}
