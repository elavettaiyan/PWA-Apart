import Foundation
import Capacitor
import PhonePePayment

// PhonePe iOS SDK integration using CocoaPods pod 'PhonePePayment'.
// SDK reference: https://developer.phonepe.com/payment-gateway/mobile-app-integration/standard-checkout-mobile/ios/sdk-setup
//
// Required setup (already applied to companion files):
//   Podfile:     pod 'PhonePePayment'
//   Info.plist:  LSApplicationQueriesSchemes + CFBundleURLTypes (scheme: dwellhubpay)
//   AppDelegate: PPPayment.checkDeeplink(url) in application(_:open:options:)

@objc(PhonePePaymentPlugin)
public class PhonePePaymentPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PhonePePaymentPlugin"
    public let jsName = "PhonePePayment"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "init", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startCheckout", returnType: CAPPluginReturnPromise),
    ]

    private var ppPayment: PPPayment?
    private var storedMerchantId: String?

    /// Initialises the PhonePe SDK.
    ///
    /// JS call:
    /// ```
    /// PhonePePayment.init({ merchantId, flowId, environment: 'SANDBOX' | 'RELEASE', enableLogging? })
    /// ```
    @objc func `init`(_ call: CAPPluginCall) {
        let merchantId = call.getString("merchantId") ?? ""
        let flowId = call.getString("flowId") ?? ""
        let environmentString = call.getString("environment") ?? "SANDBOX"
        let enableLogging = call.getBool("enableLogging") ?? false

        NSLog("[PhonePe] init — merchantId: %@, env: %@, flowId: %@, logging: %d",
              merchantId, environmentString, flowId, enableLogging ? 1 : 0)

        guard !merchantId.isEmpty else {
            NSLog("[PhonePe] init rejected — merchantId is empty")
            call.reject("merchantId is required")
            return
        }
        guard !flowId.isEmpty else {
            NSLog("[PhonePe] init rejected — flowId is empty")
            call.reject("flowId is required")
            return
        }

        let environment: Environment = environmentString == "RELEASE" ? .production : .sandbox

        if enableLogging {
            PPPayment.enableDebugLogs = true
        }

        let payment = PPPayment(
            environment: environment,
            flowId: flowId,
            merchantId: merchantId
        )

        self.ppPayment = payment
        self.storedMerchantId = merchantId

        NSLog("[PhonePe] PPPayment created successfully — env: %@", environmentString)
        call.resolve(["success": true])
    }

    /// Starts the PhonePe checkout UI.
    ///
    /// JS call:
    /// ```
    /// PhonePePayment.startCheckout({ token, orderId })
    /// ```
    /// Resolves with `{ resultCode: number, ok: boolean, state: string, transactionId?: string }`.
    @objc func startCheckout(_ call: CAPPluginCall) {
        let orderId = call.getString("orderId") ?? ""
        let token = call.getString("token") ?? ""

        NSLog("[PhonePe] startCheckout — orderId: %@", orderId)

        guard !token.isEmpty else {
            NSLog("[PhonePe] startCheckout rejected — token is empty")
            call.reject("token is required")
            return
        }
        guard !orderId.isEmpty else {
            NSLog("[PhonePe] startCheckout rejected — orderId is empty")
            call.reject("orderId is required")
            return
        }
        guard let ppPayment = ppPayment, let merchantId = storedMerchantId else {
            NSLog("[PhonePe] startCheckout rejected — SDK not initialised")
            call.reject("PhonePe SDK not initialised — call init() first")
            return
        }

        NSLog("[PhonePe] calling startCheckoutFlow — orderId: %@, merchantId: %@, appSchema: dwellhubpay", orderId, merchantId)

        DispatchQueue.main.async { [weak self] in
            guard let self, let vc = self.bridge?.viewController else {
                NSLog("[PhonePe] startCheckout rejected — viewController unavailable")
                call.reject("View controller unavailable")
                return
            }

            ppPayment.startCheckoutFlow(
                merchantId: merchantId,
                orderId: orderId,
                token: token,
                appSchema: "dwellhubpay",
                on: vc
            ) { [weak self] transactionPayload, state in
                // Log raw state and payload for debugging
                NSLog("[PhonePe] startCheckoutFlow completion — state: %@", String(describing: state))
                NSLog("[PhonePe] transactionPayload type: %@", String(describing: type(of: transactionPayload)))
                NSLog("[PhonePe] transactionPayload: %@", String(describing: transactionPayload))

                let ok: Bool
                let stateName: String
                switch state {
                case .success:
                    ok = true
                    stateName = "success"
                default:
                    ok = false
                    stateName = String(describing: state)
                }

                // Build result — extract PhonePe transactionId if present in payload
                var result: [String: Any] = [
                    "resultCode": ok ? 1 : 0,
                    "ok": ok,
                    "state": stateName,
                ]
                if let payloadDict = transactionPayload as? [String: Any] {
                    if let txnId = payloadDict["transactionId"] as? String, !txnId.isEmpty {
                        result["transactionId"] = txnId
                        NSLog("[PhonePe] transactionId from payload: %@", txnId)
                    }
                    if let status = payloadDict["status"] as? String {
                        NSLog("[PhonePe] payload status: %@", status)
                    }
                }

                NSLog("[PhonePe] resolving JS — ok: %@, state: %@", ok ? "true" : "false", stateName)
                call.resolve(result)
                self?.ppPayment = nil
                self?.storedMerchantId = nil
            }
        }
    }
}
