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
        guard let merchantId = call.getString("merchantId"), !merchantId.isEmpty else {
            call.reject("merchantId is required")
            return
        }
        guard let flowId = call.getString("flowId"), !flowId.isEmpty else {
            call.reject("flowId is required")
            return
        }

        let environmentString = call.getString("environment") ?? "SANDBOX"
        let enableLogging = call.getBool("enableLogging") ?? false

        let environment: PPEnvironment = environmentString == "RELEASE" ? .production : .sandbox

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

        call.resolve(["success": true])
    }

    /// Starts the PhonePe checkout UI.
    ///
    /// JS call:
    /// ```
    /// PhonePePayment.startCheckout({ token, orderId })
    /// ```
    /// Resolves with `{ resultCode: number, ok: boolean }`.
    @objc func startCheckout(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), !token.isEmpty else {
            call.reject("token is required")
            return
        }
        guard let orderId = call.getString("orderId"), !orderId.isEmpty else {
            call.reject("orderId is required")
            return
        }
        guard let ppPayment = ppPayment, let merchantId = storedMerchantId else {
            call.reject("PhonePe SDK not initialised — call init() first")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self, let vc = self.bridge?.viewController else {
                call.reject("View controller unavailable")
                return
            }

            ppPayment.startCheckoutFlow(
                merchantId: merchantId,
                orderId: orderId,
                token: token,
                appSchema: "dwellhubpay",
                on: vc
            ) { [weak self] _, state in
                let ok: Bool
                switch state {
                case .success:
                    ok = true
                default:
                    ok = false
                }
                call.resolve(["resultCode": ok ? 1 : 0, "ok": ok])
                self?.ppPayment = nil
                self?.storedMerchantId = nil
            }
        }
    }
}
