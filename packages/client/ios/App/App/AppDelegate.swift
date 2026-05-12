import UIKit
import Capacitor
import PhonePePayment
import FirebaseCore
import FirebaseMessaging

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, MessagingDelegate {

    private let pushTokenPreferencesKey = "push.notification.token"

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Initialise Firebase — must be before Capacitor so FCM swizzles APNs registration
        // and Capacitor Push returns an FCM token (not a raw APNs token).
        FirebaseApp.configure()
        // Set Firebase delegate — Capacitor's NotificationRouter owns UNUserNotificationCenter.delegate.
        Messaging.messaging().delegate = self
        NSLog("[Push-Native] didFinishLaunching completed")
        return true
    }

    // MARK: – APNs → Firebase token forwarding (required when swizzling is disabled)

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let hexToken = deviceToken.map { String(format: "%02x", $0) }.joined()
        NSLog("[Push-Native] APNs token (%ld bytes): %@…", deviceToken.count, String(hexToken.prefix(20)))
        // Pass the APNs token to Firebase with an explicit environment so FCM can map it correctly.
        #if DEBUG
        Messaging.messaging().setAPNSToken(deviceToken, type: .sandbox)
        #else
        Messaging.messaging().setAPNSToken(deviceToken, type: .prod)
        #endif
        Messaging.messaging().token { token, error in
            if let error {
                NSLog("[Push-Native] Failed to fetch FCM token after APNs registration: %@", String(describing: error))
                return
            }

            guard let token else {
                NSLog("[Push-Native] Firebase returned nil FCM token after APNs registration")
                return
            }

            NSLog("[Push-Native] Immediate FCM token fetch (%ld chars): %@…", token.count, String(token.prefix(20)))
            UserDefaults.standard.set(token, forKey: self.pushTokenPreferencesKey)
            NotificationCenter.default.post(
                name: .capacitorDidRegisterForRemoteNotifications,
                object: token
            )
        }
    }

    func application(_ application: UIApplication,
                     didReceiveRemoteNotification userInfo: [AnyHashable: Any],
                     fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        NSLog("[Push-Native] didReceiveRemoteNotification: %@", String(describing: userInfo))
        // Capacitor handles notification display via UNUserNotificationCenterDelegate (notificationRouter).
        completionHandler(.newData)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NSLog("[Push-Native] Failed to register: %@", String(describing: error))
        NotificationCenter.default.post(
            name: .capacitorDidFailToRegisterForRemoteNotifications,
            object: error
        )
    }

    // MARK: – MessagingDelegate — fires when Firebase issues/refreshes an FCM token

    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let fcmToken else { return }
        NSLog("[Push-Native] FCM token (%ld chars): %@…", fcmToken.count, String(fcmToken.prefix(20)))
        UserDefaults.standard.set(fcmToken, forKey: pushTokenPreferencesKey)
        // Forward the FCM token string to Capacitor's push plugin using the correct notification name.
        NotificationCenter.default.post(
            name: .capacitorDidRegisterForRemoteNotifications,
            object: fcmToken
        )
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        NSLog("[PhonePe] application:open:url — scheme: %@, url: %@", url.scheme ?? "nil", url.absoluteString)
        // Let PhonePe SDK handle its own deep-link callback first.
        let handled = PPPayment.checkDeeplink(url)
        NSLog("[PhonePe] PPPayment.checkDeeplink — handled: %@", handled ? "YES" : "NO")
        if handled {
            return true
        }
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
